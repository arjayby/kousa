import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { MediaStore } from "@kousa/db/media-store";
import { imageMimeTypes } from "@kousa/media/contracts";
import type { CanvasNode } from "@kousa/projects/canvas";
import type { ProjectService } from "@kousa/projects/service";
import {
	generateInput,
	generationHistoryActionInput,
	generationHistoryInput,
	imageCreditCost,
	imageModels,
	listGenerationsInput,
	type PublicRun,
	speechCreditCost,
	speechModels,
	speechVoices,
	textCreditCost,
	textModels,
	videoAspectRatios,
	videoCreditCost,
	videoDurations,
	videoModels,
} from "./contracts";
import { resolveInputs } from "./freshness";
import {
	captureSettings,
	historicalSettings,
	resolveTextOutputs,
	selectedRun,
	settingsPatch,
} from "./history";
import { generationImageOrigin } from "./image-origin";
import {
	buildImagePrompt,
	buildPrompt,
	buildSpeechScript,
	buildVideoPrompt,
	GenerationError,
	generationInputHash,
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
	videoInputImageAssetId,
	videoInputSnapshot,
} from "./input";

export type { ImageProvider, TextProvider } from "./providers";

function publicRun(run: GenerationRun): PublicRun {
	return {
		id: run.id,
		resolvedInputs: run.resolvedInputs,
		nodeId: run.nodeId,
		userId: run.userId,
		modelId: run.modelId,
		kind: run.kind,
		transcript: run.kind === "speech" ? run.prompt : null,
		voiceId: run.voiceId,
		assetId: run.assetId,
		inputImageAssetId: run.inputImageAssetId,
		status: run.status,
		cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
		stage: run.stage,
		output: run.output,
		error: run.error,
		credits: run.credits,
		createdAt: run.createdAt.toISOString(),
		inputHash: run.inputHash,
	};
}

export function createGenerationService(
	store: GenerationStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	jobs: {
		textConfigured: boolean;
		imageConfigured: boolean;
		speechConfigured?: boolean;
		videoConfigured?: boolean;
		imageInputOrigin?: string;
		dispatch: (id: string) => Promise<void>;
	},
	media?: Pick<MediaStore, "get">,
) {
	const imageOrigin = generationImageOrigin(jobs.imageInputOrigin);
	async function dispatch(id: string) {
		try {
			await jobs.dispatch(id);
		} catch {
			// The committed row is an outbox entry. A scheduled sweep will dispatch it
			// with the same instance ID even if this request disappears or dispatch fails.
		}
	}
	async function getOwnedRun(
		actorId: string,
		input: { id: string; projectId: string; canvasId?: string; nodeId: string },
	) {
		const run = await store.get(input.id);
		if (
			run &&
			(run.userId !== actorId ||
				run.projectId !== input.projectId ||
				run.canvasId !== (input.canvasId ?? input.projectId) ||
				run.nodeId !== input.nodeId)
		)
			throw new GenerationError(
				"CONFLICT",
				"This request ID has already been used.",
			);
		return run;
	}
	return {
		async history(actorId: string, raw: unknown) {
			const { projectId, canvasId, nodeId, limit, cursor } =
				generationHistoryInput.parse(raw);
			await projects.get(actorId, { projectId });
			await store.expire(projectId);
			const rows = await store.history(
				projectId,
				nodeId,
				limit,
				cursor,
				canvasId,
			);
			const page = rows.slice(0, limit);
			const runs = await Promise.all(
				page.map(async ({ run, userName, plan }) => ({
					...publicRun(run),
					userName,
					graphRunId: run.graphRunId,
					completedAt: run.completedAt?.toISOString() ?? null,
					prompt: run.prompt,
					size: run.size,
					duration: run.duration,
					aspectRatio: run.aspectRatio,
					voiceDirection: run.voiceDirection,
					settings: historicalSettings(run, plan),
					mediaAvailable: run.assetId
						? Boolean(media && (await media.get(projectId, run.assetId)))
						: run.kind === "text",
					creditState:
						run.status === "succeeded"
							? ("charged" as const)
							: run.status === "failed" || run.status === "cancelled"
								? ("released" as const)
								: ("reserved" as const),
				})),
			);
			const last = page.at(-1);
			return {
				runs,
				nextCursor:
					rows.length > limit && last
						? { createdAt: last.cursorTime, id: last.run.id }
						: null,
			};
		},
		// Authorize and validate a shared-document edit. The client applies only
		// this patch through the existing permission-enforced Yjs transport/undo.
		async historyAction(actorId: string, raw: unknown) {
			const { projectId, canvasId, nodeId, runId, action } =
				generationHistoryActionInput.parse(raw);
			const project = await projects.get(actorId, { projectId });
			if (!project.permissions.canEdit)
				throw new GenerationError(
					"FORBIDDEN",
					"Only owners and editors can change shared outputs or settings.",
				);
			const { document } = await projects.getCanvas(actorId, {
				projectId,
				canvasId,
			});
			const node = document.nodes.find((n) => n.id === nodeId);
			const detail = await store.historyDetail(
				projectId,
				nodeId,
				runId,
				canvasId,
			);
			if (!node || !detail || detail.run.kind !== node.type)
				throw new GenerationError(
					"BAD_REQUEST",
					"This generation is unavailable for this node.",
				);
			let patch: Partial<CanvasNode["data"]>;
			if (action === "select") {
				const run = await selectedRun(
					store,
					projectId,
					nodeId,
					node.type,
					runId,
					canvasId,
				);
				if (
					run.assetId &&
					(!media || !(await media.get(projectId, run.assetId)))
				)
					throw new GenerationError(
						"BAD_REQUEST",
						"The saved media is unavailable. Choose another output.",
					);
				patch = {
					selectedRunId: run.id,
					...(node.type === "image"
						? { imageSource: "generated" as const }
						: {}),
					...(node.type === "video" || node.type === "speech"
						? { mediaSource: "generated" as const }
						: {}),
				};
			} else {
				const latest = (await store.latest(projectId, [nodeId], canvasId))[0];
				if (latest?.status === "queued" || latest?.status === "running")
					throw new GenerationError(
						"CONFLICT",
						"Wait for this node's active generation before restoring settings.",
					);
				const settings = historicalSettings(detail.run, detail.plan);
				if (!settings)
					throw new GenerationError(
						"BAD_REQUEST",
						"This older run has no authored settings snapshot. You can still copy its frozen prompt.",
					);
				patch = settingsPatch(settings);
			}
			const current = await projects.get(actorId, { projectId });
			if (!current.permissions.canEdit)
				throw new GenerationError("FORBIDDEN", "Your editing access changed.");
			return { patch };
		},

		async list(actorId: string, raw: unknown) {
			const {
				projectId,
				canvasId,
				nodeIds,
				selections = [],
			} = listGenerationsInput.parse(raw);
			await projects.get(actorId, { projectId });
			await store.expire(projectId);
			const [
				runs,
				balance,
				imageResults,
				speechResults,
				videoResults,
				textResults,
				selectedResults,
			] = await Promise.all([
				store.latest(projectId, nodeIds, canvasId),
				store.balance(actorId),
				store.outputs(projectId, nodeIds, "image", canvasId),
				store.outputs(projectId, nodeIds, "speech", canvasId),
				store.outputs(projectId, nodeIds, "video", canvasId),
				store.outputs(projectId, nodeIds, "text", canvasId),
				store.getMany(
					projectId,
					selections.map((selection) => selection.runId),
					canvasId,
				),
			]);
			return {
				runs: runs.map(publicRun),
				textResults: textResults.map(publicRun),
				selectedResults: selectedResults
					.filter(
						(run) =>
							run.status === "succeeded" &&
							selections.some(
								(selection) =>
									selection.nodeId === run.nodeId && selection.runId === run.id,
							),
					)
					.map(publicRun),
				balance,
				imageResults: imageResults.map(publicRun),
				speechResults: speechResults.map(publicRun),
				videoResults: videoResults.map(publicRun),
				videoConfigured: jobs.videoConfigured ?? false,
				imageToVideoConfigured: Boolean(
					jobs.videoConfigured && imageOrigin && media,
				),
				speechConfigured: jobs.speechConfigured ?? false,
				imageConfigured: jobs.imageConfigured,
				configured: jobs.textConfigured,
			};
		},
		async generate(actorId: string, raw: unknown) {
			const input = generateInput.parse(raw);
			const access = await projects.get(actorId, input);
			if (!access.permissions.canEdit)
				throw new GenerationError(
					"FORBIDDEN",
					"Only owners and editors can generate.",
				);
			await store.expire(input.projectId);
			const previous = await getOwnedRun(actorId, input);
			if (previous) {
				if (previous.status === "queued") await dispatch(previous.id);
				return publicRun(previous);
			}
			const { document } = await projects.getCanvas(actorId, input);
			const node = document.nodes.find((node) => node.id === input.nodeId);
			const kind = node?.type;
			if (
				!node ||
				(kind !== "text" &&
					kind !== "image" &&
					kind !== "speech" &&
					kind !== "video")
			)
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose a text, image, video, or speech node to generate.",
				);
			const configured = {
				text: jobs.textConfigured,
				image: jobs.imageConfigured,
				speech: jobs.speechConfigured,
				video: jobs.videoConfigured,
			}[kind];
			if (!configured)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"AI generation is not configured yet.",
				);
			if (
				(await generationInputHash(document, input.nodeId)) !== input.inputHash
			)
				throw new GenerationError(
					"CONFLICT",
					"The shared prompt changed or is still saving. Wait for it to sync, then try again.",
				);
			const snapshot =
				kind === "video"
					? {
							kind: "video" as const,
							...videoInputSnapshot(document, input.nodeId),
						}
					: kind === "speech"
						? {
								kind: "speech" as const,
								...speechInputSnapshot(document, input.nodeId),
							}
						: kind === "image"
							? {
									kind: "image" as const,
									...imageInputSnapshot(document, input.nodeId),
								}
							: {
									kind: "text" as const,
									...textInputSnapshot(document, input.nodeId),
								};
			const models = {
				text: textModels,
				image: imageModels,
				speech: speechModels,
				video: videoModels,
			}[kind];
			if (
				snapshot.kind === "speech" &&
				!speechVoices.some((voice) => voice.id === snapshot.voiceId)
			)
				throw new GenerationError("BAD_REQUEST", "Choose an available voice.");
			if (!models.some((model) => model.id === snapshot.modelId))
				throw new GenerationError(
					"BAD_REQUEST",
					`Choose an available ${kind} model.`,
				);
			if (
				snapshot.kind === "video" &&
				(!videoDurations.some((d) => d === snapshot.duration) ||
					!videoAspectRatios.some((r) => r === snapshot.aspectRatio))
			)
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose an available video duration and aspect ratio.",
				);
			let inputImageAssetId: string | null = null;
			let resolvedImage: GenerationRun | undefined;
			if (
				(snapshot.kind === "video" || snapshot.kind === "image") &&
				snapshot.image
			) {
				const generated = snapshot.image.runId
					? await selectedRun(
							store,
							input.projectId,
							snapshot.image.nodeId,
							"image",
							snapshot.image.runId,
							input.canvasId,
						)
					: (
							await store.outputs(
								input.projectId,
								[snapshot.image.nodeId],
								"image",
								input.canvasId,
							)
						)[0];
				resolvedImage = generated;
				inputImageAssetId = videoInputImageAssetId(
					snapshot,
					generated?.assetId,
				);
				if (!inputImageAssetId)
					throw new GenerationError(
						"BAD_REQUEST",
						"Upload or generate an image on the connected image node first.",
					);
				if (input.inputImageAssetId !== inputImageAssetId)
					throw new GenerationError(
						"CONFLICT",
						"The connected image changed. Review it, then try again.",
					);
				if (snapshot.kind === "video" && !imageOrigin)
					throw new GenerationError(
						"SERVICE_UNAVAILABLE",
						"Image-to-video needs a public HTTPS app URL so the provider can fetch this image.",
					);
				const asset = await media?.get(input.projectId, inputImageAssetId);
				if (!asset || !imageMimeTypes.some((type) => type === asset.mimeType))
					throw new GenerationError(
						"BAD_REQUEST",
						"Choose an available image from this project.",
					);
			} else if (input.inputImageAssetId) {
				throw new GenerationError(
					"CONFLICT",
					"The connected image changed. Review it, then try again.",
				);
			}
			const outputs = await resolveTextOutputs(
				store,
				input.projectId,
				snapshot.sources,
				input.canvasId,
			);
			const prompt =
				snapshot.kind === "speech"
					? buildSpeechScript(snapshot, outputs)
					: snapshot.kind === "video"
						? buildVideoPrompt(snapshot, outputs)
						: snapshot.kind === "image"
							? buildImagePrompt(snapshot, outputs)
							: buildPrompt(snapshot, outputs);
			const credits = {
				text: textCreditCost,
				image: imageCreditCost,
				speech: speechCreditCost,
				video:
					snapshot.kind === "video" ? videoCreditCost(snapshot.duration) : 0,
			}[kind];
			const claim = await store.claim({
				...input,
				userId: actorId,
				modelId: snapshot.modelId,
				authoredSettings: captureSettings(node, snapshot.modelId),
				resolvedInputs: resolveInputs(snapshot, outputs, resolvedImage),
				prompt,
				credits,
				kind,
				inputImageAssetId,
				inputImageOrigin:
					snapshot.kind === "video" && inputImageAssetId ? imageOrigin : null,
				duration: snapshot.kind === "video" ? snapshot.duration : null,
				aspectRatio: snapshot.kind === "video" ? snapshot.aspectRatio : null,
				size: snapshot.kind === "image" ? snapshot.size : null,
				voiceId: snapshot.kind === "speech" ? snapshot.voiceId : null,
				voiceDirection:
					snapshot.kind === "speech" ? snapshot.voiceDirection : null,
			});
			if (claim.error) {
				if (claim.error === "NO_CREDITS")
					throw new GenerationError(
						"PAYMENT_REQUIRED",
						`You need ${credits} ${credits === 1 ? "credit" : "credits"} to generate ${kind}.`,
					);
				if (claim.error === "FORBIDDEN")
					throw new GenerationError(
						"FORBIDDEN",
						"Your editing access changed. Refresh this project.",
					);
				throw new GenerationError(
					"CONFLICT",
					claim.error === "BUSY"
						? "A generation is already running for you or this node. Wait for it to finish."
						: "This request ID has already been used.",
				);
			}
			if (!claim.claimed) {
				const run = await getOwnedRun(actorId, input);
				if (!run)
					throw new GenerationError(
						"SERVICE_UNAVAILABLE",
						"Could not load the existing run.",
					);
				return publicRun(run);
			}
			await dispatch(input.id);
			const run = await store.get(input.id);
			if (!run)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"Could not load the queued run. Refresh to check its status.",
				);
			return publicRun(run);
		},
	};
}
export type GenerationService = ReturnType<typeof createGenerationService>;
