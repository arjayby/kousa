import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { MediaService } from "@kousa/media/service";
import {
	imageModels,
	imageSizes,
	isRunActive,
	speechModels,
	speechVoices,
	textModels,
} from "./contracts";
import type { ImageProvider, SpeechProvider, TextProvider } from "./providers";

export type TextResult = Awaited<ReturnType<TextProvider["generate"]>>;
export type Artifact =
	| ({ kind: "text" } & TextResult)
	| ({ kind: "speech" } & Awaited<ReturnType<SpeechProvider["generate"]>>)
	| ({ kind: "image" } & Awaited<ReturnType<ImageProvider["generate"]>>);
export interface ArtifactStore {
	get(id: string): Promise<Artifact | null>;
	put(id: string, artifact: Artifact): Promise<void>;
	delete(id: string): Promise<void>;
}
export type PreparedResult = TextResult | { assetId: string } | null;
const failure =
	"Generation could not finish. Your credits were released. You can try again.";

export function createGenerationRunner(
	store: GenerationStore,
	artifacts: ArtifactStore,
	text: TextProvider,
	image: ImageProvider,
	media: Pick<MediaService, "stage"> &
		Partial<Pick<MediaService, "stageSpeech">>,
	speech?: SpeechProvider,
) {
	async function active(id: string): Promise<GenerationRun | null> {
		const run = await store.get(id);
		if (!run || !isRunActive(run)) return null;
		if (run.expiresAt.getTime() <= Date.now()) {
			await store.expire(run.projectId);
			return null;
		}
		return run;
	}
	async function fail(id: string): Promise<undefined> {
		await store.finish(id, { error: failure });
		const run = await store.get(id);
		if (run) await store.expire(run.projectId);
	}
	return {
		async generate(id: string) {
			const run = await active(id);
			if (!run) return false;
			// Recover an already saved provider response if a step checkpoint was lost.
			if (await artifacts.get(id)) return true;
			if (!(await store.start(id))) {
				const current = await active(id);
				if (!current) return false;
				// A crashed or overlapping execution must never repeat the paid call. Allow
				// the original 90s request time to finish and save its receipt before failing.
				if (
					current.providerStartedAt &&
					Date.now() - current.providerStartedAt.getTime() >= 120_000
				) {
					await fail(id);
					return false;
				}
				throw new Error("Waiting to recover the provider result");
			}
			let result: Artifact;
			try {
				if (run.kind === "speech") {
					if (
						!speech?.configured ||
						!speechModels.some((m) => m.id === run.modelId) ||
						!speechVoices.some((v) => v.id === run.voiceId) ||
						!run.voiceId
					)
						throw new Error("Unavailable speech model or voice");
					result = {
						kind: "speech",
						...(await speech.generate({
							modelId: run.modelId,
							text: run.prompt,
							voiceId: run.voiceId,
							voiceDirection: run.voiceDirection ?? "",
						})),
					};
					if (
						!result.bytes.length ||
						result.bytes.length > 10 * 1024 * 1024 ||
						result.mimeType !== "audio/mpeg"
					)
						throw new Error("Invalid speech output");
				} else if (run.kind === "image") {
					if (
						!image.configured ||
						!imageModels.some((m) => m.id === run.modelId)
					)
						throw new Error("Unavailable image model");
					const size = Object.values(imageSizes).find(
						(size) => size === run.size,
					);
					if (!size) throw new Error("Invalid image size");
					result = {
						kind: "image",
						...(await image.generate({
							modelId: run.modelId,
							prompt: run.prompt,
							size,
						})),
					};
					if (!result.bytes.length || result.bytes.length > 10 * 1024 * 1024)
						throw new Error("Invalid image output");
				} else {
					if (!text.configured || !textModels.some((m) => m.id === run.modelId))
						throw new Error("Unavailable text model");
					result = {
						kind: "text",
						...(await text.generate({
							modelId: run.modelId,
							prompt: run.prompt,
						})),
					};
					if (!result.output.trim() || result.output.length > 50_000)
						throw new Error("Invalid text output");
				}
			} catch {
				await fail(id);
				return false;
			}
			// Retry only storing these exact bytes, never the provider call. On uncertain
			// completion the next step attempt first checks this durable receipt.
			for (let attempt = 0; ; attempt++) {
				try {
					await artifacts.put(id, result);
					break;
				} catch {
					if (attempt === 2)
						throw new Error("Could not confirm provider result storage");
					await new Promise((resolve) =>
						setTimeout(resolve, 500 * (attempt + 1)),
					);
				}
			}
			return true;
		},
		async prepare(id: string): Promise<PreparedResult> {
			const run = await active(id);
			if (!run) return null;
			await store.markSaving(id);
			const result = await artifacts.get(id);
			if (!result || result.kind !== run.kind)
				throw new Error("Stored generation result unavailable");
			if (result.kind === "text")
				return {
					output: result.output,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				};
			if (result.kind === "speech") {
				if (!media.stageSpeech) throw new Error("Audio storage unavailable");
				const asset = await media.stageSpeech(run.userId, run.projectId, {
					...result,
					name: `Generated speech ${id.slice(0, 8)}.mp3`,
				});
				return { assetId: asset.id };
			}
			const extension =
				result.mimeType === "image/jpeg"
					? "jpg"
					: result.mimeType === "image/webp"
						? "webp"
						: "png";
			const asset = await media.stage(run.userId, run.projectId, {
				...result,
				name: `Generated image ${id.slice(0, 8)}.${extension}`,
			});
			return { assetId: asset.id };
		},
		async finalize(id: string, result: PreparedResult): Promise<undefined> {
			if (!result || !(await active(id))) return;
			if ("assetId" in result) await store.finishMedia(id, result.assetId);
			else await store.finish(id, result);
			const run = await store.get(id);
			if (run) await store.expire(run.projectId);
		},
		fail,
		async cleanup(id: string): Promise<undefined> {
			const run = await store.get(id);
			if (run && !isRunActive(run)) await artifacts.delete(id);
		},
	};
}
