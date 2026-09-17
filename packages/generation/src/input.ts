import {
	type CanvasDocument,
	imageOutputAssetId,
} from "@kousa/projects/canvas";
import {
	defaultImageModel,
	defaultSpeechModel,
	defaultSpeechVoice,
	defaultVideoModel,
	imageSizes,
	maxInputBytes,
	maxSpeechCharacters,
	resolveTextModel,
} from "./contracts";

export class GenerationError extends Error {
	constructor(
		public readonly code:
			| "BAD_REQUEST"
			| "FORBIDDEN"
			| "CONFLICT"
			| "SERVICE_UNAVAILABLE"
			| "PAYMENT_REQUIRED",
		message: string,
	) {
		super(message);
	}
}

export function textInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "text")
		throw new GenerationError("BAD_REQUEST", "Select a text node to generate.");
	const sources = graph.edges
		.filter((e) => e.target === nodeId)
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((edge) => {
			const source = graph.nodes.find((n) => n.id === edge.source);
			if (source?.type !== "text")
				throw new GenerationError(
					"BAD_REQUEST",
					"Text generation currently accepts connected text nodes only.",
				);
			return { id: source.id, content: source.data.content };
		});
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
	const sources = graph.edges
		.filter((edge) => edge.target === nodeId)
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((edge) => {
			const source = graph.nodes.find((n) => n.id === edge.source);
			if (edge.targetHandle !== "prompt" || source?.type !== "text")
				throw new GenerationError(
					"BAD_REQUEST",
					"Image generation accepts text prompts only. Disconnect reference images before generating.",
				);
			return { id: source.id, content: source.data.content };
		});
	return {
		nodeId,
		modelId: node.data.imageModel ?? defaultImageModel,
		content: node.data.content,
		sources,
		size: imageSizes[node.data.aspectRatio],
	};
}

export async function generationInputHash(
	graph: CanvasDocument,
	nodeId: string,
) {
	const kind = graph.nodes.find((node) => node.id === nodeId)?.type;
	if (kind !== "image" && kind !== "speech" && kind !== "video")
		return textInputHash(graph, nodeId);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(
			JSON.stringify(
				kind === "video"
					? videoInputSnapshot(graph, nodeId)
					: kind === "speech"
						? speechInputSnapshot(graph, nodeId)
						: imageInputSnapshot(graph, nodeId),
			),
		),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export function buildImagePrompt(
	snapshot: Pick<ReturnType<typeof imageInputSnapshot>, "content" | "sources">,
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
	if (new TextEncoder().encode(prompt).length > maxInputBytes)
		throw new GenerationError(
			"BAD_REQUEST",
			"The prompt and connected text exceed 12 KB. Shorten them before generating.",
		);
	return prompt;
}

export function speechInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "speech")
		throw new GenerationError(
			"BAD_REQUEST",
			"Select a speech node to generate.",
		);
	const sources = graph.edges
		.filter((e) => e.target === nodeId)
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((edge) => {
			const source = graph.nodes.find((n) => n.id === edge.source);
			if (edge.targetHandle !== "script" || source?.type !== "text")
				throw new GenerationError(
					"BAD_REQUEST",
					"Speech generation accepts connected text scripts only.",
				);
			return { id: source.id, content: source.data.content };
		});
	return {
		nodeId,
		modelId: node.data.speechModel ?? defaultSpeechModel,
		voiceId: node.data.voiceId ?? defaultSpeechVoice,
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

export function videoInputSnapshot(graph: CanvasDocument, nodeId: string) {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (node?.type !== "video")
		throw new GenerationError(
			"BAD_REQUEST",
			"Select a video node to generate.",
		);
	const images: Array<{
		nodeId: string;
		imageSource: "generated" | "project";
		assetId?: string | null;
	}> = [];
	const sources = graph.edges
		.filter((e) => e.target === nodeId)
		.sort((a, b) => a.id.localeCompare(b.id))
		.flatMap((edge) => {
			const source = graph.nodes.find((n) => n.id === edge.source);
			if (edge.targetHandle === "image" && source?.type === "image") {
				if (images.length)
					throw new GenerationError(
						"BAD_REQUEST",
						"Connect only one image to the video node.",
					);
				images.push({
					nodeId: source.id,
					imageSource:
						source.data.imageSource ??
						(source.data.assetId ? "project" : "generated"),
					assetId: source.data.assetId,
				});
				return [];
			}
			if (edge.targetHandle !== "prompt" || source?.type !== "text")
				throw new GenerationError(
					"BAD_REQUEST",
					"Video generation accepts text prompts and one image. Disconnect video and audio inputs before generating.",
				);
			return [{ id: source.id, content: source.data.content }];
		});
	return {
		nodeId,
		modelId: node.data.videoModel ?? defaultVideoModel,
		content: node.data.content,
		sources,
		aspectRatio: node.data.aspectRatio,
		duration: Number(node.data.duration),
		image: images[0] ?? null,
	};
}

export function videoInputImageAssetId(
	snapshot: ReturnType<typeof videoInputSnapshot>,
	generatedAssetId?: string | null,
) {
	return snapshot.image
		? (imageOutputAssetId(snapshot.image, generatedAssetId) ?? null)
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
