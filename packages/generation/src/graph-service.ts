import type { GenerationStore } from "@kousa/db/generation-store";
import type { GraphRun, GraphStore } from "@kousa/db/graph-store";
import type { MediaStore } from "@kousa/db/media-store";
import type { GraphStep } from "@kousa/db/schema/graph-runs";
import { imageMimeTypes } from "@kousa/media/contracts";
import type { ProjectService } from "@kousa/projects/service";
import {
	graphPreviewInput,
	graphProjectInput,
	graphStartInput,
	planGraph,
} from "./graph-plan";
import { generationImageOrigin } from "./image-origin";
import { GenerationError } from "./input";

export function createGraphService(
	store: GraphStore,
	generations: GenerationStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	jobs: {
		configured: boolean;
		imageInputOrigin?: string;
		dispatch: (id: string) => Promise<void>;
	},
	media?: Pick<MediaStore, "get">,
) {
	const imageOrigin = generationImageOrigin(jobs.imageInputOrigin);
	async function prepareInputs(projectId: string, plan: GraphStep[]) {
		for (const step of plan) {
			if (step.reused || step.kind !== "video" || !step.image) continue;
			step.inputImageOrigin = imageOrigin;
			if (step.image.imageSource === "project") {
				const asset =
					step.image.assetId && media
						? await media.get(projectId, step.image.assetId)
						: null;
				if (!asset || !imageMimeTypes.some((type) => type === asset.mimeType))
					throw new GenerationError(
						"BAD_REQUEST",
						"Choose an available image from this project before running the workflow.",
					);
			}
		}
		return plan.some(
			(step) => !step.reused && step.kind === "video" && step.image,
		) && !imageOrigin
			? [
					"Image-to-video needs a public HTTPS app URL so the provider can fetch the starting image. No workflow credits will be reserved until this is configured.",
				]
			: [];
	}
	async function access(actorId: string, projectId: string, edit = false) {
		const project = await projects.get(actorId, { projectId });
		if (edit && !project.permissions.canEdit)
			throw new GenerationError(
				"FORBIDDEN",
				"Only owners and editors can run workflows.",
			);
	}
	async function dispatch(id: string) {
		try {
			await jobs.dispatch(id);
		} catch {
			/* The saved run is a recoverable outbox entry. */
		}
	}
	async function publicRun(
		run: GraphRun,
		resumed = false,
		knownResults?: Awaited<ReturnType<GraphStore["results"]>>,
	) {
		const results = new Map(
			(
				knownResults ??
				(await store.results(run.plan.map((step) => step.runId)))
			).map((result) => [result.id, result]),
		);
		return {
			id: run.id,
			nodeId: run.nodeId,
			userId: run.userId,
			status: run.status,
			error: run.error,
			createdAt: run.createdAt.toISOString(),
			remainingCredits: run.remainingCredits,
			resumed,
			steps: run.plan.map((step) => ({
				nodeId: step.nodeId,
				label: step.label,
				kind: step.kind,
				credits: step.credits,
				reused: step.reused,
				status:
					results.get(step.runId)?.status ??
					(run.status === "failed"
						? ("blocked" as const)
						: ("waiting" as const)),
				error: results.get(step.runId)?.error ?? null,
			})),
		};
	}
	async function makePlan(
		actorId: string,
		input: { projectId: string; nodeId: string; resumeOf?: string },
	) {
		if (!input.resumeOf)
			return planGraph(
				(await projects.getCanvas(actorId, input)).document,
				input.nodeId,
			);
		const previous = await store.get(input.resumeOf);
		if (
			!previous ||
			previous.projectId !== input.projectId ||
			previous.userId !== actorId ||
			previous.nodeId !== input.nodeId
		)
			throw new GenerationError(
				"FORBIDDEN",
				"Only the person who started this workflow can resume it.",
			);
		if (previous.status !== "failed")
			throw new GenerationError(
				"CONFLICT",
				"This workflow does not need to be resumed.",
			);
		const results = new Map(
			(await store.results(previous.plan.map((step) => step.runId))).map(
				(result) => [result.id, result],
			),
		);
		return {
			inputHash: previous.inputHash,
			plan: previous.plan.map((step) => ({
				...step,
				reused: results.get(step.runId)?.status === "succeeded",
			})),
		};
	}
	return {
		async list(actorId: string, raw: unknown) {
			const { projectId } = graphProjectInput.parse(raw);
			await access(actorId, projectId);
			await store.expire(projectId);
			const runs = await store.list(projectId);
			const resumed = new Set(runs.map((run) => run.resumeOf));
			const results = await store.results([
				...new Set(runs.flatMap((run) => run.plan.map((step) => step.runId))),
			]);
			return {
				runs: await Promise.all(
					runs.map((run) => publicRun(run, resumed.has(run.id), results)),
				),
				configured: jobs.configured,
			};
		},
		async preview(actorId: string, raw: unknown) {
			const input = graphPreviewInput.parse(raw);
			await access(actorId, input.projectId, true);
			const { plan, inputHash } = await makePlan(actorId, input);
			if (input.inputHash && input.inputHash !== inputHash)
				throw new GenerationError(
					"CONFLICT",
					"The workflow changed or is still saving. Wait for it to sync, then preview again.",
				);
			const blockers = await prepareInputs(input.projectId, plan);
			return {
				blockers,
				inputHash,
				credits: plan.reduce(
					(sum, step) => sum + (step.reused ? 0 : step.credits),
					0,
				),
				balance: await generations.balance(actorId),
				steps: plan.map((step) => ({
					nodeId: step.nodeId,
					label: step.label,
					kind: step.kind,
					credits: step.credits,
					reused: step.reused,
					imageInput:
						step.kind === "video" && step.image ? step.image.imageSource : null,
					speech:
						step.kind === "speech"
							? { voiceId: step.voiceId, voiceDirection: step.voiceDirection }
							: null,
				})),
			};
		},
		async start(actorId: string, raw: unknown) {
			const input = graphStartInput.parse(raw);
			await access(actorId, input.projectId, true);
			const previous = await store.get(input.id);
			if (previous) {
				if (
					previous.userId !== actorId ||
					previous.projectId !== input.projectId ||
					previous.nodeId !== input.nodeId ||
					previous.resumeOf !== (input.resumeOf ?? null)
				)
					throw new GenerationError(
						"CONFLICT",
						"This request ID has already been used.",
					);
				if (previous.status === "running") await dispatch(previous.id);
				return publicRun(previous);
			}
			if (!jobs.configured)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"AI generation is not configured yet.",
				);
			await store.expire();
			const { plan, inputHash } = await makePlan(actorId, input);
			if (inputHash !== input.inputHash)
				throw new GenerationError(
					"CONFLICT",
					"The workflow changed. Preview it again before starting.",
				);
			const blockers = await prepareInputs(input.projectId, plan);
			if (blockers[0])
				throw new GenerationError("SERVICE_UNAVAILABLE", blockers[0]);
			const result = await store.claim({
				...input,
				userId: actorId,
				resumeOf: input.resumeOf ?? null,
				plan: plan.map((step) => ({
					...step,
					runId: step.reused ? step.runId : crypto.randomUUID(),
				})),
			});
			if (result.error) {
				if (result.error === "NO_CREDITS")
					throw new GenerationError(
						"PAYMENT_REQUIRED",
						"You need enough credits for all unfinished steps.",
					);
				if (result.error === "FORBIDDEN")
					throw new GenerationError(
						"FORBIDDEN",
						"Your editing access changed. Refresh this project.",
					);
				throw new GenerationError(
					"CONFLICT",
					result.error === "BUSY"
						? "A generation or workflow is already running for you or this project."
						: "This workflow has already been resumed or this request ID is in use.",
				);
			}
			await dispatch(input.id);
			const saved = await store.get(input.id);
			if (!saved)
				throw new Error(
					"Could not confirm the workflow. Check its status before starting another.",
				);
			return publicRun(saved);
		},
	};
}
export type GraphService = ReturnType<typeof createGraphService>;
