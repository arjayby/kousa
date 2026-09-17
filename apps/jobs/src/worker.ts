import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { databaseClient } from "@kousa/db/client";
import { createGenerationStore } from "@kousa/db/generation-store";
import { createGraphStore } from "@kousa/db/graph-store";
import { createMediaStore } from "@kousa/db/media-store";
import { createProjectStore } from "@kousa/db/project-store";
import {
	createGatewayImageProvider,
	createGatewayProvider,
	createGatewaySpeechProvider,
} from "@kousa/generation/gateway";
import { createGatewayVideoProvider } from "@kousa/generation/gateway-video";
import { executeGraphWorkflow } from "@kousa/generation/graph-workflow";
import { createGenerationRunner } from "@kousa/generation/runner";
import { executeGenerationWorkflow } from "@kousa/generation/workflow";
import { createMediaService } from "@kousa/media/service";
import { r2Storage } from "@kousa/media/storage";
import { z } from "zod";
import { r2Artifacts } from "./artifacts";

interface JobsEnv {
	DATABASE_URL: string;
	AI_GATEWAY_API_KEY: string;
	MEDIA: R2Bucket;
	GENERATION: Workflow<{ runId: string }>;
}
function runtime(env: JobsEnv) {
	const db = databaseClient(env.DATABASE_URL);
	const store = createGenerationStore(db);
	const runner = createGenerationRunner(
		store,
		r2Artifacts(env.MEDIA),
		createGatewayProvider(env.AI_GATEWAY_API_KEY),
		createGatewayImageProvider(env.AI_GATEWAY_API_KEY),
		createMediaService(
			createMediaStore(db),
			createProjectStore(db),
			r2Storage(env.MEDIA),
		),
		createGatewaySpeechProvider(env.AI_GATEWAY_API_KEY),
		createGatewayVideoProvider(env.AI_GATEWAY_API_KEY),
	);
	return { store, runner, graphs: createGraphStore(db) };
}
export class GenerationWorkflow extends WorkflowEntrypoint<
	JobsEnv,
	{ runId: string }
> {
	async run(
		event: Readonly<WorkflowEvent<{ runId: string }>>,
		step: WorkflowStep,
	) {
		const id = z.uuid().parse(event.payload.runId);
		if (event.instanceId !== id) throw new Error("Workflow identity mismatch");
		const { store, runner, graphs } = runtime(this.env);
		if (await graphs.get(id))
			return executeGraphWorkflow(id, graphs, store, runner, step);
		return executeGenerationWorkflow(id, runner, step);
	}
}
async function enqueue(env: JobsEnv, ids: string[]) {
	if (!ids.length) return;
	// Unlike create(), createBatch() is idempotent for an existing instance ID.
	await env.GENERATION.createBatch(
		ids.map((id) => ({ id, params: { runId: id } })),
	);
}
async function recover(env: JobsEnv) {
	const { store, runner, graphs } = runtime(env);
	await store.expire();
	await graphs.expire();
	const pending = await store.pending();
	const pendingGraphs = await graphs.pending();
	await enqueue(
		env,
		[...pending, ...pendingGraphs].map((run) => run.id),
	);
	for (const run of [...pending, ...pendingGraphs]) {
		const instance = await env.GENERATION.get(run.id);
		const status = await instance.status();
		if (status.status === "errored" || status.status === "terminated") {
			if (pendingGraphs.some((graph) => graph.id === run.id)) {
				await graphs.finish(
					run.id,
					"The workflow was interrupted. Resume to continue unfinished steps.",
				);
			} else {
				await runner.fail(run.id);
				await runner.cleanup(run.id);
			}
		}
	}
}
export default {
	// Production has no public route or workers.dev URL. Only the web service
	// binding can dispatch runs. The body cannot supply a payer, model or prompt.
	async fetch(request: Request, env: JobsEnv) {
		const match = new URL(request.url).pathname.match(/^\/runs\/([^/]+)$/);
		const parsed = z.uuid().safeParse(match?.[1]);
		if (request.method !== "POST" || !parsed.success)
			return new Response("Not found", { status: 404 });
		const { store, graphs } = runtime(env);
		const graph = await graphs.get(parsed.data);
		if (graph?.status === "running" && graph.expiresAt.getTime() > Date.now()) {
			await enqueue(env, [graph.id]);
			return new Response(null, { status: 202 });
		}
		const run = await store.get(parsed.data);
		if (
			!run ||
			run.graphRunId ||
			!["queued", "running"].includes(run.status) ||
			run.expiresAt.getTime() <= Date.now()
		)
			return new Response(null, { status: 204 });
		await enqueue(env, [run.id]);
		return new Response(null, { status: 202 });
	},
	async scheduled(_event: ScheduledController, env: JobsEnv) {
		await recover(env);
	},
} satisfies ExportedHandler<JobsEnv>;
