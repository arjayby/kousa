import type { CanvasDocument } from "@kousa/projects/canvas";
import { maxInputBytes, resolveTextModel } from "./contracts";

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
