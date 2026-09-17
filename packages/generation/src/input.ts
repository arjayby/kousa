import type { CanvasDocument } from "@kousa/projects/canvas";
import {
	defaultImageModel,
	defaultSpeechModel,
	defaultSpeechVoice,
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
		defaultSpeechModel,
		defaultSpeechVoice,
		maxSpeechCharacters,
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
	if (kind !== "image" && kind !== "speech")
		return textInputHash(graph, nodeId);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(
			JSON.stringify(
				kind === "speech"
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
	snapshot: ReturnType<typeof imageInputSnapshot>,
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
