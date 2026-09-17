import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { MediaService } from "@kousa/media/service";
import type { ProjectService } from "@kousa/projects/service";
import {
	generateInput,
	imageCreditCost,
	imageModels,
	listGenerationsInput,
	type PublicRun,
	textCreditCost,
	textModels,
} from "./contracts";
import {
	buildImagePrompt,
	buildPrompt,
	GenerationError,
	generationInputHash,
	imageInputSnapshot,
	textInputSnapshot,
} from "./input";

export interface TextProvider {
	configured: boolean;
	generate(input: { modelId: string; prompt: string }): Promise<{
		output: string;
		inputTokens: number | null;
		outputTokens: number | null;
	}>;
}
export interface ImageProvider {
	configured: boolean;
	generate(input: {
		modelId: string;
		prompt: string;
		size: `${number}x${number}`;
	}): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }>;
}
function publicRun(run: GenerationRun): PublicRun {
	return {
		id: run.id,
		nodeId: run.nodeId,
		userId: run.userId,
		modelId: run.modelId,
		kind: run.kind,
		assetId: run.assetId,
		status: run.status,
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
	provider: TextProvider,
	image?: { provider: ImageProvider; media: Pick<MediaService, "stage"> },
) {
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
			const [runs, balance, imageResults] = await Promise.all([
				store.latest(projectId, nodeIds),
				store.balance(actorId),
				store.outputs(projectId, nodeIds, "image"),
			]);
			return {
				runs: runs.map(publicRun),
				balance,
				imageResults: imageResults.map(publicRun),
				imageConfigured: image?.provider.configured ?? false,
				configured: provider.configured,
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
			if (previous) return publicRun(previous);
			const { document } = await projects.getCanvas(actorId, input);
			const kind =
				document.nodes.find((node) => node.id === input.nodeId)?.type ===
				"image"
					? "image"
					: "text";
			if (
				!(kind === "image" ? image?.provider.configured : provider.configured)
			)
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
				kind === "image"
					? {
							kind: "image" as const,
							...imageInputSnapshot(document, input.nodeId),
						}
					: {
							kind: "text" as const,
							...textInputSnapshot(document, input.nodeId),
						};
			const models = kind === "image" ? imageModels : textModels;
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
				snapshot.kind === "image"
					? buildImagePrompt(snapshot, outputs)
					: buildPrompt(snapshot, outputs);
			const credits = kind === "image" ? imageCreditCost : textCreditCost;
			const claim = await store.claim({
				...input,
				userId: actorId,
				modelId: snapshot.modelId,
				prompt,
				credits,
				kind,
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
			let result:
				| Awaited<ReturnType<TextProvider["generate"]>>
				| { assetId: string };
			try {
				if (snapshot.kind === "image" && image) {
					const output = await image.provider.generate({
						modelId: snapshot.modelId,
						prompt,
						size: snapshot.size,
					});
					const extension =
						output.mimeType === "image/jpeg"
							? "jpg"
							: output.mimeType === "image/webp"
								? "webp"
								: "png";
					const asset = await image.media.stage(actorId, input.projectId, {
						...output,
						name: `Generated image ${input.id.slice(0, 8)}.${extension}`,
					});
					result = { assetId: asset.id };
				} else {
					result = await provider.generate({
						modelId: snapshot.modelId,
						prompt,
					});
					if (!result.output.trim() || result.output.length > 50_000)
						throw new Error("Invalid model output");
				}
			} catch {
				// Provider errors may contain credentials or prompts. Store only this safe message.
				const failed = await store.finish(input.id, {
					error:
						"Generation or saving failed. Your credits were released. Try again.",
				});
				await store.expire(input.projectId);
				const run = failed ?? (await store.get(input.id));
				if (!run)
					throw new GenerationError(
						"SERVICE_UNAVAILABLE",
						"Could not load the run. Refresh to check its status.",
					);
				return publicRun(run);
			}
			// Output and debit become final in the same atomic update. A database failure
			// must not be mistaken for a provider failure or cause a second provider call.
			const finished =
				"assetId" in result
					? await store.finishImage(input.id, result.assetId)
					: await store.finish(input.id, result);
			await store.expire(input.projectId);
			const run = finished ?? (await store.get(input.id));
			if (!run)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"Could not load the run. Refresh to check its status.",
				);
			return publicRun(run);
		},
	};
}
export type GenerationService = ReturnType<typeof createGenerationService>;
