import type { GenerationStore } from "@kousa/db/generation-store";
import type { GraphRun, GraphStore } from "@kousa/db/graph-store";
import type { MediaStore } from "@kousa/db/media-store";
import type { GraphStep } from "@kousa/db/schema/graph-runs";
import { imageMimeTypes } from "@kousa/media/contracts";
import type { ProjectService } from "@kousa/projects/service";
import { fingerprint, graphFreshness } from "./freshness";
import {
	graphPreviewInput,
	graphProjectInput,
	graphRunTargetIds,
	graphStartInput,
	graphTargetIds,
	planGraph,
} from "./graph-plan";
import { graphDependencies } from "./graph-selection";
import { selectedRun } from "./history";
import { generationImageOrigin } from "./image-origin";
import {
	buildImagePrompt,
	buildPrompt,
	buildSpeechScript,
	buildVideoPrompt,
	GenerationError,
} from "./input";

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
			if (step.reused) continue;
			const pinned = await Promise.all(
				step.sources.flatMap((source) => {
					const runId =
						source.runId ??
						plan.find((item) => item.nodeId === source.id && item.reused)
							?.runId;
					return runId
						? [selectedRun(generations, projectId, source.id, "text", runId)]
						: [];
				}),
			);
			if (pinned.length) {
				if (step.kind === "speech") buildSpeechScript(step, pinned);
				else if (step.kind === "video") buildVideoPrompt(step, pinned);
				else if (step.kind === "image") buildImagePrompt(step, pinned);
				else buildPrompt(step, pinned);
			}
			if (step.kind !== "video" || !step.image) continue;
			if (step.image.imageSource === "history") {
				if (!step.image.runId)
					throw new GenerationError(
						"BAD_REQUEST",
						"Choose an available historical image.",
					);
				const run = await selectedRun(
					generations,
					projectId,
					step.image.nodeId,
					"image",
					step.image.runId,
				);
				step.image.assetId = run.assetId;
			}
			step.inputImageOrigin = imageOrigin;
			if (!imageOrigin)
				step.blocker =
					"Image-to-video needs a public HTTPS app URL so the provider can fetch the starting image. No workflow credits will be reserved until this is configured.";
			if (
				step.image.imageSource === "project" ||
				step.image.imageSource === "history"
			) {
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
		// Show blocked dependants too, while withholding the entire reservation.
		for (const step of plan) {
			if (step.reused || step.blocker) continue;
			const blocked = plan.find(
				(source) =>
					source.blocker &&
					(step.sources.some(
						(input) => !input.runId && input.id === source.nodeId,
					) ||
						(step.kind === "video" &&
							step.image?.imageSource === "generated" &&
							step.image.nodeId === source.nodeId)),
			);
			if (blocked)
				step.blocker = `Blocked by ${blocked.label || blocked.kind}.`;
		}
		return [
			...new Set(plan.flatMap((step) => (step.blocker ? [step.blocker] : []))),
		];
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
		const targets = graphRunTargetIds(run);
		const results = new Map(
			(
				knownResults ??
				(await store.results(run.plan.map((step) => step.runId)))
			).map((result) => [result.id, result]),
		);
		return {
			id: run.id,
			nodeId: run.nodeId,
			targetNodeIds: targets,
			userId: run.userId,
			status: run.status,
			cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
			error: run.error,
			createdAt: run.createdAt.toISOString(),
			remainingCredits: run.remainingCredits,
			resumed,
			steps: run.plan.map((step) => ({
				nodeId: step.nodeId,
				isOutput: targets.includes(step.nodeId),
				label: step.label,
				kind: step.kind,
				credits: step.credits,
				reused: step.reused,
				status:
					results.get(step.runId)?.status ??
					(run.cancelRequestedAt
						? ("cancelled" as const)
						: run.status === "failed"
							? ("blocked" as const)
							: ("waiting" as const)),
				error: results.get(step.runId)?.error ?? null,
			})),
		};
	}
	async function makePlan(
		actorId: string,
		input: {
			projectId: string;
			nodeId?: string;
			nodeIds?: string[];
			resumeOf?: string;
			mode?: "affected" | "force";
		},
	) {
		const targets = graphTargetIds(input);
		if (!input.resumeOf) {
			const graph = (await projects.getCanvas(actorId, input)).document;
			const planned = await planGraph(graph, targets);
			const nodeIds = graph.nodes.map((node) => node.id);
			const results = (
				await Promise.all([
					...(["text", "image", "speech", "video"] as const).map((kind) =>
						generations.outputs(input.projectId, nodeIds, kind),
					),
					generations.getMany(
						input.projectId,
						graph.nodes.flatMap((node) =>
							node.data.selectedRunId ? [node.data.selectedRunId] : [],
						),
					),
				])
			)
				.flat()
				.filter((run) => run.status === "succeeded");
			const states = graphFreshness(graph, results);
			const dependencies = graphDependencies(graph);
			const byNode = new Map(planned.plan.map((step) => [step.nodeId, step]));
			for (const step of planned.plan) {
				const state = states.get(step.nodeId);
				step.reason = state?.reason;
				if (state?.state === "blocked") step.blocker = state.reason;
				const upstream = [...(dependencies.get(step.nodeId) ?? [])].some(
					(id) => byNode.has(id) && !byNode.get(id)?.reused,
				);
				const result = results.find((run) => run.id === state?.runId);
				step.reused =
					input.mode !== "force" && state?.state === "current" && !upstream;
				if (input.mode === "force")
					step.reason = "Force regeneration requested.";
				else if (upstream && state?.state === "current")
					step.reason = "An upstream step will regenerate.";
				if (
					step.reused &&
					result?.assetId &&
					(!media || !(await media.get(input.projectId, result.assetId)))
				) {
					step.reused = false;
					step.reason = "Saved media is unavailable.";
				}
				if (step.reused && result) step.runId = result.id;
			}
			return { ...planned, canvasHash: planned.inputHash };
		}
		const previous = await store.get(input.resumeOf);
		if (
			!previous ||
			previous.projectId !== input.projectId ||
			previous.userId !== actorId ||
			JSON.stringify(graphRunTargetIds(previous)) !== JSON.stringify(targets)
		)
			throw new GenerationError(
				"FORBIDDEN",
				"Only the person who started this workflow can resume it.",
			);
		if (previous.status !== "failed" && previous.status !== "cancelled")
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
			canvasHash: previous.inputHash,
			plan: previous.plan.map((step) => ({
				...step,
				reused: results.get(step.runId)?.status === "succeeded",
			})),
		};
	}
	async function reviewHash(
		input: { resumeOf?: string; mode?: string },
		canvasHash: string,
		plan: GraphStep[],
	) {
		if (input.resumeOf) return canvasHash;
		return fingerprint({
			canvasHash,
			mode: input.mode ?? "affected",
			steps: plan.map((step) => ({
				nodeId: step.nodeId,
				inputHash: step.inputHash,
				reused: step.reused,
				runId: step.reused ? step.runId : null,
				sources: step.sources.map((source) => ({
					nodeId: source.id,
					runId: source.runId ?? null,
				})),
				image: step.kind === "video" ? step.image : null,
			})),
		});
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
			const targets = graphTargetIds(input);
			await access(actorId, input.projectId, true);
			const { plan, canvasHash } = await makePlan(actorId, input);
			const blockers = await prepareInputs(input.projectId, plan);
			const inputHash = await reviewHash(input, canvasHash, plan);
			if (
				input.inputHash &&
				input.inputHash !== canvasHash &&
				input.inputHash !== inputHash
			)
				throw new GenerationError(
					"CONFLICT",
					"The workflow changed or is still saving. Wait for it to sync, then preview again.",
				);
			return {
				blockers,
				targetNodeIds: targets,
				inputHash,
				credits: plan.reduce(
					(sum, step) => sum + (step.reused ? 0 : step.credits),
					0,
				),
				balance: await generations.balance(actorId),
				steps: plan.map((step) => ({
					nodeId: step.nodeId,
					isOutput: targets.includes(step.nodeId),
					label: step.label,
					kind: step.kind,
					credits: step.credits,
					reused: step.reused,
					reason:
						step.reason ??
						(step.reused
							? "Completed in the saved workflow."
							: "Unfinished step."),
					blocker: step.blocker ?? null,
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
			const targets = graphTargetIds(input);
			const nodeId = targets[0];
			if (!nodeId)
				throw new GenerationError("BAD_REQUEST", "Choose a workflow output.");
			await access(actorId, input.projectId, true);
			const previous = await store.get(input.id);
			if (previous) {
				if (
					previous.userId !== actorId ||
					previous.projectId !== input.projectId ||
					previous.inputHash !== input.inputHash ||
					JSON.stringify(graphRunTargetIds(previous)) !==
						JSON.stringify(targets) ||
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
			const { plan, canvasHash } = await makePlan(actorId, input);
			const blockers = await prepareInputs(input.projectId, plan);
			const inputHash = await reviewHash(input, canvasHash, plan);
			if (inputHash !== input.inputHash)
				throw new GenerationError(
					"CONFLICT",
					"The workflow changed. Preview it again before starting.",
				);
			if (blockers[0])
				throw new GenerationError("SERVICE_UNAVAILABLE", blockers[0]);
			const result = await store.claim({
				...input,
				nodeId,
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
