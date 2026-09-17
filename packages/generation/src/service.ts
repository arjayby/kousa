import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { ProjectService } from "@kousa/projects/service";
import {
	generateInput,
	imageCreditCost,
	imageModels,
	listGenerationsInput,
	type PublicRun,
	speechCreditCost,
	speechModels,
	speechVoices,
	textCreditCost,
	textModels,
} from "./contracts";
import {
	buildImagePrompt,
	buildPrompt,
	buildSpeechScript,
	GenerationError,
	generationInputHash,
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
} from "./input";

export type { ImageProvider, TextProvider } from "./providers";

function publicRun(run: GenerationRun): PublicRun {
	return {
		id: run.id,
		nodeId: run.nodeId,
		userId: run.userId,
		modelId: run.modelId,
		kind: run.kind,
		transcript: run.kind === "speech" ? run.prompt : null,
		voiceId: run.voiceId,
		assetId: run.assetId,
		status: run.status,
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
		dispatch: (id: string) => Promise<void>;
	},
) {
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
		input: { id: string; projectId: string; nodeId: string },
	) {
		const run = await store.get(input.id);
		if (
			run &&
			(run.userId !== actorId ||
				run.projectId !== input.projectId ||
				run.nodeId !== input.nodeId)
		)
			throw new GenerationError(
				"CONFLICT",
				"This request ID has already been used.",
			);
		return run;
	}
	return {
		async list(actorId: string, raw: unknown) {
			const { projectId, nodeIds } = listGenerationsInput.parse(raw);
			await projects.get(actorId, { projectId });
			await store.expire(projectId);
			const [runs, balance, imageResults, speechResults] = await Promise.all([
				store.latest(projectId, nodeIds),
				store.balance(actorId),
				store.outputs(projectId, nodeIds, "image"),
				store.outputs(projectId, nodeIds, "speech"),
			]);
			return {
				runs: runs.map(publicRun),
				balance,
				imageResults: imageResults.map(publicRun),
				speechResults: speechResults.map(publicRun),
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
			const kind = document.nodes.find(
				(node) => node.id === input.nodeId,
			)?.type;
			if (kind !== "text" && kind !== "image" && kind !== "speech")
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose a text, image, or speech node to generate.",
				);
			const configured = {
				text: jobs.textConfigured,
				image: jobs.imageConfigured,
				speech: jobs.speechConfigured,
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
				kind === "speech"
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
			const outputs = await store.outputs(
				input.projectId,
				snapshot.sources.map((s) => s.id),
			);
			const prompt =
				snapshot.kind === "speech"
					? buildSpeechScript(snapshot, outputs)
					: snapshot.kind === "image"
						? buildImagePrompt(snapshot, outputs)
						: buildPrompt(snapshot, outputs);
			const credits = {
				text: textCreditCost,
				image: imageCreditCost,
				speech: speechCreditCost,
			}[kind];
			const claim = await store.claim({
				...input,
				userId: actorId,
				modelId: snapshot.modelId,
				prompt,
				credits,
				kind,
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
