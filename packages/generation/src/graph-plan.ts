import type { GraphStep } from "@kousa/db/schema/graph-runs";
import type { CanvasDocument } from "@kousa/projects/canvas";
import { z } from "zod";
import {
	imageCreditCost,
	imageModels,
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

export const graphProjectInput = z.object({ projectId: z.uuid() });
export const graphPreviewInput = graphProjectInput.extend({
	nodeId: z.uuid(),
	resumeOf: z.uuid().optional(),
	inputHash: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.optional(),
});
export const graphStartInput = graphPreviewInput.extend({
	id: z.uuid(),
	inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function planGraph(graph: CanvasDocument, targetId: string) {
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: string[] = [];
	function visit(id: string) {
		if (visiting.has(id))
			throw new GenerationError(
				"BAD_REQUEST",
				"Disconnect the cycle before running this workflow.",
			);
		if (visited.has(id)) return;
		const node = nodes.get(id);
		if (!node)
			throw new GenerationError(
				"BAD_REQUEST",
				"A workflow node is missing. Refresh the canvas.",
			);
		if (node.type !== "text" && node.type !== "image")
			throw new GenerationError(
				"BAD_REQUEST",
				"Workflows currently support text and image nodes only.",
			);
		visiting.add(id);
		for (const edge of graph.edges
			.filter((edge) => edge.target === id)
			.sort((a, b) => a.id.localeCompare(b.id)))
			visit(edge.source);
		visiting.delete(id);
		visited.add(id);
		ordered.push(id);
		if (ordered.length > 20)
			throw new GenerationError(
				"BAD_REQUEST",
				"Run up to 20 connected nodes at a time.",
			);
	}
	visit(targetId);
	const plan: GraphStep[] = await Promise.all(
		ordered.map(async (nodeId) => {
			const node = nodes.get(nodeId);
			if (!node) throw new Error("Missing planned node");
			const kind = node.type === "image" ? "image" : "text";
			const snapshot =
				kind === "image"
					? imageInputSnapshot(graph, nodeId)
					: textInputSnapshot(graph, nodeId);
			if (
				!(kind === "image" ? imageModels : textModels).some(
					(model) => model.id === snapshot.modelId,
				)
			)
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose an available model before running the workflow.",
				);
			// Validate written prompts before reserving. Generated context is validated
			// again when each step starts, since its length is not known in advance.
			if (kind === "image") buildImagePrompt(snapshot, []);
			else buildPrompt(snapshot, []);
			return {
				...snapshot,
				kind,
				label: node.data.label,
				size:
					"size" in snapshot && typeof snapshot.size === "string"
						? snapshot.size
						: null,
				inputHash: await generationInputHash(graph, nodeId),
				credits: kind === "image" ? imageCreditCost : textCreditCost,
				runId: "",
				reused: false,
			};
		}),
	);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(
			JSON.stringify(
				plan.map(({ nodeId, inputHash, credits }) => ({
					nodeId,
					inputHash,
					credits,
				})),
			),
		),
	);
	const inputHash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return { plan, inputHash };
}
