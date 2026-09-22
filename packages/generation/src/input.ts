import {
	type CanvasDocument,
	imageOutputAssetId,
} from "@kousa/projects/canvas";
import { resolveConnection } from "./connections";
import {
	defaultImageModel,
	defaultVideoModel,
	maxInputBytes,
	maxSpeechCharacters,
	resolveTextModel,
} from "./contracts";

import {
	defaultVoiceFor,
	imageQualityFor,
	imageSizeFor,
	resolveSpeechModel,
} from "./model-catalog";

export class GenerationError extends Error {
	constructor(
		public readonly code:
			| "BAD_REQUEST"
			| "NOT_FOUND"
			| "FORBIDDEN"
			| "CONFLICT"
			| "SERVICE_UNAVAILABLE"
			| "PAYMENT_REQUIRED",
		message: string,
	) {
		super(message);
	}
}

function resolvedConnections(graph: CanvasDocument, nodeId: string) {
	return graph.edges
		.filter((edge) => edge.target === nodeId)
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((edge) => {
			const input = resolveConnection(graph, edge);
			if (!input)
				throw new GenerationError(
					"BAD_REQUEST",
					"Both connected nodes must exist.",
				);
			if (input.usage === "unsupported")
				throw new GenerationError("BAD_REQUEST", input.description);
			return { edge, ...input };
		});
}

function connectedText(graph: CanvasDocument, nodeId: string) {
	return resolvedConnections(graph, nodeId)
		.filter((input) => input.usage === "text")
		.map(({ source }) => ({
			id: source.id,
			content: source.data.content,
			...(source.data.selectedRunId
				? { runId: source.data.selectedRunId }
				: {}),
		}));
}

export function textInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "text")
		throw new GenerationError("BAD_REQUEST", "Select a text node to generate.");
	const sources = connectedText(graph, nodeId);
	return {
		nodeId,
		modelId: resolveTextModel(node.data.textModel),
		content: node.data.content,
		sources,
	};
}

export async function textInputHash(graph: CanvasDocument, nodeId: string) {
	const bytes = new TextEncoder().encode(
		JSON.stringify(textInputSnapshot(graph, nodeId)),
	);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export function buildPrompt(
	snapshot: ReturnType<typeof textInputSnapshot>,
	outputs: Array<{ nodeId: string; output: string | null }>,
) {
	if (!snapshot.content.trim())
		throw new GenerationError(
			"BAD_REQUEST",
			"Write a prompt before generating.",
		);
	const context = snapshot.sources
		.map(
			(source) =>
				outputs.find((o) => o.nodeId === source.id)?.output ?? source.content,
		)
		.join("\n\n");
	const prompt = context
		? `Connected text context:\n${context}\n\nYour task:\n${snapshot.content}`
		: snapshot.content;
	if (new TextEncoder().encode(prompt).length > maxInputBytes)
		throw new GenerationError(
			"BAD_REQUEST",
			"The prompt and connected text exceed 12 KB. Shorten them before generating.",
		);
	return prompt;
}

export function imageInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "image")
		throw new GenerationError(
			"BAD_REQUEST",
			"Select an image node to generate.",
		);
	const sources = connectedText(graph, nodeId);
	return {
		nodeId,
		modelId: node.data.imageModel ?? defaultImageModel,
		content: node.data.content,
		sources,
		image: connectedImage(graph, nodeId),
		size: imageSizeFor(
			node.data.imageModel ?? defaultImageModel,
			node.data.aspectRatio,
		),
		...(imageQualityFor(
			node.data.imageModel ?? defaultImageModel,
			node.data.imageQuality,
		)
			? {
					imageQuality: imageQualityFor(
						node.data.imageModel ?? defaultImageModel,
						node.data.imageQuality,
					),
				}
			: {}),
	};
}

export async function generationInputHash(
	graph: CanvasDocument,
	nodeId: string,
) {
	const kind = graph.nodes.find((node) => node.id === nodeId)?.type;
	if (kind !== "image" && kind !== "audio" && kind !== "video")
		return textInputHash(graph, nodeId);
	const snapshot =
		kind === "video"
			? videoInputSnapshot(graph, nodeId)
			: kind === "audio"
				? speechInputSnapshot(graph, nodeId)
				: imageInputSnapshot(graph, nodeId);
	// Keep hashes stable for saved text-to-image workflows created before references.
	const hashInput =
		"size" in snapshot && !snapshot.image
			? { ...snapshot, image: undefined }
			: snapshot;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(hashInput)),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export function buildImagePrompt(
	snapshot: Pick<
		ReturnType<typeof imageInputSnapshot>,
		"content" | "sources"
	> & { modelId?: string },
	outputs: Array<{ nodeId: string; output: string | null }>,
) {
	const prompt = [
		...snapshot.sources.map(
			(source) =>
				outputs.find((o) => o.nodeId === source.id)?.output ?? source.content,
		),
		snapshot.content,
	]
		.map((text) => text.trim())
		.filter(Boolean)
		.join("\n\n");
	if (!prompt)
		throw new GenerationError(
			"BAD_REQUEST",
			"Write a prompt or connect a text node before generating.",
		);
	if (snapshot.modelId?.startsWith("recraft/") && prompt.length > 10_000)
		throw new GenerationError(
			"BAD_REQUEST",
			"Recraft prompts must be 10,000 characters or fewer.",
		);
	if (new TextEncoder().encode(prompt).length > maxInputBytes)
		throw new GenerationError(
			"BAD_REQUEST",
			"The prompt and connected text exceed 12 KB. Shorten them before generating.",
		);
	return prompt;
}

export function speechInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "audio")
		throw new GenerationError(
			"BAD_REQUEST",
			"Select an Audio node to generate speech.",
		);
	const sources = connectedText(graph, nodeId);
	return {
		nodeId,
		modelId: resolveSpeechModel(node.data.speechModel),
		voiceId:
			node.data.voiceId ??
			defaultVoiceFor(resolveSpeechModel(node.data.speechModel)),
		voiceDirection: node.data.voiceDirection.trim(),
		content: node.data.content,
		sources,
	};
}
export function buildSpeechScript(
	snapshot: ReturnType<typeof speechInputSnapshot>,
	outputs: Array<{ nodeId: string; output: string | null }>,
) {
	const script = [
		...snapshot.sources.map(
			(source) =>
				outputs.find((o) => o.nodeId === source.id)?.output ?? source.content,
		),
		snapshot.content,
	]
		.map((s) => s.trim())
		.filter(Boolean)
		.join("\n\n");
	if (!script)
		throw new GenerationError(
			"BAD_REQUEST",
			"Write a script or connect a text node before generating.",
		);
	if (Array.from(script).length > maxSpeechCharacters)
		throw new GenerationError(
			"BAD_REQUEST",
			"The script and connected text exceed 1,000 characters. Shorten them before generating.",
		);
	return script;
}

function connectedImage(graph: CanvasDocument, nodeId: string) {
	const images: Array<{
		nodeId: string;
		imageSource: "generated" | "project" | "history";
		runId?: string;
		assetId?: string | null;
	}> = [];
	const inputs = resolvedConnections(graph, nodeId);
	for (const { source, usage } of inputs) {
		if (usage !== "image") continue;
		if (images.length)
			throw new GenerationError(
				"BAD_REQUEST",
				"Connect only one image to this node.",
			);
		images.push({
			nodeId: source.id,
			runId: source.data.selectedRunId ?? undefined,
			imageSource: source.data.selectedRunId
				? "history"
				: (source.data.imageSource ??
					(source.data.assetId ? "project" : "generated")),
			assetId: source.data.assetId,
		});
	}
	return images.at(0) ?? null;
}

export function videoInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "video")
		throw new GenerationError(
			"BAD_REQUEST",
			"Select a video node to generate.",
		);
	const sources = connectedText(graph, nodeId);
	return {
		nodeId,
		modelId: node.data.videoModel ?? defaultVideoModel,
		content: node.data.content,
		sources,
		aspectRatio: node.data.aspectRatio,
		duration: Number(node.data.duration),
		image: connectedImage(graph, nodeId),
	};
}

export function videoInputImageAssetId(
	snapshot: Pick<ReturnType<typeof videoInputSnapshot>, "image">,
	generatedAssetId?: string | null,
) {
	return snapshot.image
		? snapshot.image.imageSource === "history"
			? (generatedAssetId ?? null)
			: (imageOutputAssetId(
					{ ...snapshot.image, imageSource: snapshot.image.imageSource },
					generatedAssetId,
				) ?? null)
		: null;
}

export function buildVideoPrompt(
	snapshot: ReturnType<typeof videoInputSnapshot>,
	outputs: Array<{ nodeId: string; output: string | null }>,
) {
	if (
		snapshot.image &&
		!snapshot.content.trim() &&
		snapshot.sources.every(
			(source) =>
				!(
					outputs.find((output) => output.nodeId === source.id)?.output ??
					source.content
				).trim(),
		)
	)
		return "";
	return buildImagePrompt(snapshot, outputs);
}
