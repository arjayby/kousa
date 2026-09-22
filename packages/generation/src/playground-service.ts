import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { MediaService } from "@kousa/media/service";
import {
	createCanvasNode,
	generationNodeKind,
	nodeLabels,
} from "@kousa/projects/canvas";
import type { ProjectService } from "@kousa/projects/service";
import { isRunActive } from "./contracts";
import {
	type AuthoredSettings,
	authoredSettingsSchema,
	settingsPatch,
} from "./history";
import { GenerationError, generationInputHash } from "./input";
import { imageSizeFor } from "./model-catalog";
import {
	playgroundCost,
	playgroundGenerateInput,
	playgroundHistoryInput,
	playgroundImportInput,
} from "./playground-contracts";

export type PlaygroundJobs = {
	textConfigured: boolean;
	imageConfigured: boolean;
	speechConfigured?: boolean;
	videoConfigured?: boolean;
	dispatch: (id: string) => Promise<void>;
};
function publicRun(run: GenerationRun) {
	return {
		id: run.id,
		kind: run.kind,
		modelId: run.modelId,
		prompt: run.prompt,
		settings: authoredSettingsSchema.parse(run.authoredSettings),
		status: run.status,
		stage: run.stage,
		output: run.output,
		assetId: run.assetId,
		error: run.error,
		credits: run.credits,
		createdAt: run.createdAt.toISOString(),
		completedAt: run.completedAt?.toISOString() ?? null,
	};
}
export type PlaygroundRun = ReturnType<typeof publicRun>;
function nodeFor(settings: AuthoredSettings, id: string) {
	const node = createCanvasNode(generationNodeKind(settings.kind), {
		x: 0,
		y: 0,
	});
	node.id = id;
	node.data = {
		...node.data,
		...settingsPatch(settings),
		label: `${nodeLabels[node.type]} from Playground`,
	};
	return node;
}
export function createPlaygroundService(
	store: GenerationStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	jobs: PlaygroundJobs,
	media: Pick<MediaService, "read" | "upload">,
) {
	const configured = {
		text: jobs.textConfigured,
		image: jobs.imageConfigured,
		speech: jobs.speechConfigured ?? false,
		video: jobs.videoConfigured ?? false,
	};
	async function dispatch(id: string) {
		try {
			await jobs.dispatch(id);
		} catch {
			/* The durable outbox retries dispatch without buying another generation. */
		}
	}
	async function owned(actorId: string, id: string) {
		const run = await store.get(id);
		if (!run || run.userId !== actorId || run.projectId !== null)
			throw new GenerationError("NOT_FOUND", "Generation not found.");
		return run;
	}
	return {
		async history(actorId: string, raw: unknown = {}) {
			const { limit, cursor } = playgroundHistoryInput.parse(raw);
			await store.expirePersonal(actorId);
			const [rows, balance, active] = await Promise.all([
				store.personalHistory(actorId, limit, cursor),
				store.balance(actorId),
				store.activeForUser(actorId),
			]);
			const page = rows.slice(0, limit);
			const last = page.at(-1);
			return {
				runs: page.map(({ run }) => publicRun(run)),
				balance,
				configured,
				busy: active,
				nextCursor:
					rows.length > limit && last
						? { createdAt: last.cursorTime, id: last.run.id }
						: null,
			};
		},
		async generate(actorId: string, raw: unknown) {
			const { id, settings } = playgroundGenerateInput.parse(raw);
			const node = nodeFor(settings, id);
			const inputHash = await generationInputHash(
				{ version: 1, nodes: [node], edges: [] },
				id,
			);
			const previous = await store.get(id);
			if (previous) {
				if (
					previous.userId !== actorId ||
					previous.projectId !== null ||
					previous.inputHash !== inputHash
				)
					throw new GenerationError(
						"CONFLICT",
						"This request ID has already been used.",
					);
				if (previous.status === "queued") await dispatch(id);
				return publicRun(previous);
			}
			if (!configured[settings.kind])
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"Generation is unavailable. Please try again later.",
				);
			const claim = await store.claimPersonal({
				id,
				userId: actorId,
				modelId: settings.modelId,
				prompt: settings.content,
				inputHash,
				credits: playgroundCost(settings),
				kind: settings.kind,
				authoredSettings: settings,
				size:
					settings.kind === "image"
						? imageSizeFor(settings.modelId, settings.aspectRatio)
						: null,
				duration: settings.kind === "video" ? settings.duration : null,
				aspectRatio: settings.kind === "video" ? settings.aspectRatio : null,
				voiceId: settings.kind === "speech" ? settings.voiceId : null,
				voiceDirection:
					settings.kind === "speech" ? settings.voiceDirection : null,
			});
			if (claim.error)
				throw new GenerationError(
					claim.error === "NO_CREDITS"
						? "PAYMENT_REQUIRED"
						: claim.error === "FORBIDDEN"
							? "FORBIDDEN"
							: "CONFLICT",
					claim.error === "NO_CREDITS"
						? `You need ${playgroundCost(settings)} credits to generate.`
						: claim.error === "BUSY"
							? "A generation or workflow is already running for you. Wait for it to finish."
							: "Could not start this generation. Refresh and try again.",
				);
			const run = await owned(actorId, id);
			if (run.inputHash !== inputHash)
				throw new GenerationError(
					"CONFLICT",
					"This request ID has already been used.",
				);
			if (run.status === "queued") await dispatch(id);
			return publicRun(run);
		},
		async importToCanvas(actorId: string, raw: unknown) {
			const input = playgroundImportInput.parse(raw);
			const source = await owned(actorId, input.runId);
			if (source.status !== "succeeded")
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose a completed generation.",
				);
			const access = await projects.get(actorId, input);
			if (!access.permissions.canEdit)
				throw new GenerationError(
					"FORBIDDEN",
					"Only owners and editors can add to this canvas.",
				);
			const { document } = await projects.getCanvas(actorId, input);
			const existing = await store.findImport(
				actorId,
				source.id,
				input.canvasId,
			);
			if (
				document.nodes.length >= 200 &&
				!document.nodes.some((n) => n.id === existing?.nodeId)
			)
				throw new GenerationError(
					"BAD_REQUEST",
					"This canvas has reached its 200-node limit.",
				);
			let imported = existing;
			if (!imported) {
				let assetId: string | null = null;
				if (source.assetId) {
					const { asset, object } = await media.read(
						actorId,
						null,
						source.assetId,
					);
					const bytes = new Uint8Array(
						await new Response(object.body).arrayBuffer(),
					);
					const copy = await media.upload(actorId, input.projectId, {
						bytes,
						name: asset.name,
						mimeType: asset.mimeType,
					});
					assetId = copy.id;
				}
				const id = crypto.randomUUID();
				const node = nodeFor(
					authoredSettingsSchema.parse(source.authoredSettings),
					id,
				);
				const inputHash = await generationInputHash(
					{ version: 1, nodes: [node], edges: [] },
					id,
				);
				const importedId = await store.importPersonal({
					id,
					userId: actorId,
					sourceRunId: source.id,
					projectId: input.projectId,
					canvasId: input.canvasId,
					assetId,
					inputHash,
				});
				if (!importedId)
					throw new GenerationError(
						"FORBIDDEN",
						"The generation or your editing access changed. Try again.",
					);
				imported = await store.get(importedId);
			}
			if (!imported || isRunActive(imported))
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"Could not load the saved generation.",
				);
			const node = nodeFor(
				authoredSettingsSchema.parse(imported.authoredSettings),
				imported.nodeId,
			);
			node.data.selectedRunId = imported.id;
			if (node.type === "image") node.data.imageSource = "generated";
			if (node.type === "video" || node.type === "audio")
				node.data.mediaSource = "generated";
			return { node };
		},
	};
}
export type PlaygroundService = ReturnType<typeof createPlaygroundService>;
