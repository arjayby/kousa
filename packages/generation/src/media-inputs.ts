import type { GenerationStore } from "@kousa/db/generation-store";
import type {
	MediaInput,
	ResolvedMediaInput,
} from "@kousa/db/schema/generation-inputs";
import type { PublicAsset } from "@kousa/media/contracts";
import type { CanvasNode } from "@kousa/projects/canvas";
import { nodeGenerationKind } from "@kousa/projects/canvas";
import { selectedRun } from "./history";
import { GenerationError } from "./input";
import { videoProfile } from "./model-catalog";

export function mediaInput(
	source: CanvasNode,
	role: MediaInput["role"],
	output?: "lastFrame" | "audio",
): MediaInput {
	if (source.type === "text") throw new Error("Expected media node");
	return {
		nodeId: source.id,
		kind:
			output === "lastFrame"
				? "image"
				: output === "audio"
					? "audio"
					: source.type,
		...(output ? { output } : {}),
		role,
		source: source.data.selectedRunId
			? "history"
			: source.type === "image"
				? (source.data.imageSource ??
					(source.data.assetId ? "project" : "generated"))
				: (source.data.mediaSource ?? "generated"),
		...(source.data.selectedRunId ? { runId: source.data.selectedRunId } : {}),
		assetId: source.data.assetId,
	};
}

export function resolveMediaInputs(
	inputs: MediaInput[] = [],
	outputs: { id: string; nodeId: string; assetId: string | null }[] = [],
): ResolvedMediaInput[] {
	return inputs.map((input) => {
		const run = outputs.find(
			(run) =>
				run.nodeId === input.nodeId && (!input.runId || run.id === input.runId),
		);
		return {
			nodeId: input.nodeId,
			kind: input.kind,
			...(input.output ? { output: input.output } : {}),
			role: input.role,
			runId:
				input.source === "project" ? null : (run?.id ?? input.runId ?? null),
			assetId:
				input.source === "project"
					? (input.assetId ?? null)
					: (run?.assetId ??
						(input.source === "generated" &&
						input.kind === "image" &&
						!input.output
							? input.assetId
							: null) ??
						null),
		};
	});
}

export async function resolveSavedMedia(
	store: GenerationStore,
	projectId: string,
	canvasId: string | undefined,
	inputs: MediaInput[] = [],
) {
	const outputs = await Promise.all(
		inputs.flatMap((input) =>
			input.source === "project"
				? []
				: [
						input.runId
							? selectedRun(
									store,
									projectId,
									input.nodeId,
									nodeGenerationKind(input.output ? "video" : input.kind),
									input.runId,
									canvasId,
								)
							: store
									.outputs(
										projectId,
										[input.nodeId],
										nodeGenerationKind(input.output ? "video" : input.kind),
										canvasId,
									)
									.then((rows) => rows[0]),
					],
		),
	);
	return resolveMediaInputs(
		inputs,
		outputs.filter((output) => output !== undefined),
	);
}

export async function validateMediaAssets(
	media:
		| {
				get: (
					projectId: string,
					assetId: string,
				) => Promise<
					| Pick<
							PublicAsset,
							"mimeType" | "bytes" | "durationMs" | "width" | "height"
					  >
					| {
							mimeType: string;
							bytes: number;
							durationMs: number | null;
							width: number | null;
							height: number | null;
					  }
					| null
				>;
		  }
		| undefined,
	projectId: string,
	inputs: ResolvedMediaInput[],
	modelId: string,
	video = false,
) {
	let totalBytes = 0;
	for (const input of inputs) {
		const asset = input.assetId
			? await media?.get(projectId, input.assetId)
			: null;
		if (!asset?.mimeType.startsWith(`${input.output ? "video" : input.kind}/`))
			throw new GenerationError(
				"BAD_REQUEST",
				`Upload or generate ${input.kind} on the connected node first.`,
			);
		totalBytes += asset.bytes;
		if (video) {
			const limit = videoProfile(modelId).inputLimits[input.kind];
			if (limit && typeof limit === "object") {
				const format =
					input.output === "lastFrame"
						? "png"
						: input.output === "audio"
							? "mp3"
							: asset.mimeType === "image/jpeg"
								? "jpeg"
								: asset.mimeType === "audio/mpeg"
									? "mp3"
									: asset.mimeType.split("/")[1];
				if (
					limit.supported_formats &&
					!limit.supported_formats.includes(format ?? "")
				)
					throw new GenerationError(
						"BAD_REQUEST",
						`This model does not accept ${asset.mimeType} references.`,
					);
				if (
					(!input.output &&
						limit.max_file_size_mb &&
						asset.bytes > limit.max_file_size_mb * 1024 * 1024) ||
					(limit.min_duration_seconds &&
						(asset.durationMs ?? 0) < limit.min_duration_seconds * 1000) ||
					(limit.max_duration_seconds &&
						(asset.durationMs ?? 0) > limit.max_duration_seconds * 1000) ||
					(limit.min_dimension_pixels &&
						Math.min(asset.width ?? 0, asset.height ?? 0) <
							limit.min_dimension_pixels) ||
					(limit.max_dimension_pixels &&
						Math.max(asset.width ?? 0, asset.height ?? 0) >
							limit.max_dimension_pixels)
				)
					throw new GenerationError(
						"BAD_REQUEST",
						`The connected ${input.kind} exceeds this model's size or duration limits.`,
					);
			}
		}
	}
	if (totalBytes > 40 * 1024 * 1024)
		throw new GenerationError(
			"BAD_REQUEST",
			"Connected media must total 40 MB or less.",
		);
}
