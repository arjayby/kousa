import {
	aspectRatios,
	type CanvasDocument,
	type CanvasNode,
	canvasDocumentSchema,
	createCanvasNode,
} from "@kousa/projects/canvas";
import { z } from "zod";
import { defaultImageModel, imageModels, maxInputBytes } from "./contracts";
import { canonical } from "./freshness";
import { validateModelSettings } from "./model-catalog";

export const maxImageVariations = 8;
export const imageVariationsSchema = z.object({
	sourceId: z.uuid(),
	mode: z.enum(["inputs", "image"]),
	referenceAssetId: z.uuid().nullable(),
	prompt: z.string().max(10_000),
	variations: z
		.array(
			z.object({
				instructions: z.string().max(2_000),
				aspectRatio: z.enum(aspectRatios),
			}),
		)
		.min(2)
		.max(maxImageVariations),
});
export type ImageVariationsRequest = z.infer<typeof imageVariationsSchema>;

// Ignore positions and unrelated branches, but refuse to silently change the
// source settings, incoming connections, or selected input while a draft is open.
export function imageVariationSourceKey(
	graph: CanvasDocument,
	sourceId: string,
) {
	const source = graph.nodes.find((node) => node.id === sourceId);
	const incoming = graph.edges
		.filter((edge) => edge.target === sourceId)
		.sort((a, b) => a.id.localeCompare(b.id));
	return canonical({
		source: source ? { type: source.type, data: source.data } : null,
		incoming: incoming.map((edge) => ({
			edge,
			data: graph.nodes.find((node) => node.id === edge.source)?.data,
		})),
	});
}

function prepareImageVariations(
	graph: CanvasDocument,
	raw: ImageVariationsRequest,
) {
	const request = imageVariationsSchema.parse(raw);
	const source = graph.nodes.find((node) => node.id === request.sourceId);
	if (source?.type !== "image")
		throw new Error("Choose an image node that is still on this canvas.");
	if (
		!imageModels.some(
			(model) => model.id === (source.data.imageModel ?? defaultImageModel),
		)
	)
		throw new Error(
			"Choose an available image model on the source node first.",
		);
	if (request.mode === "image" && !request.referenceAssetId)
		throw new Error(
			"Upload or generate an image before using it as a reference.",
		);
	const incoming = graph.edges.filter((edge) => edge.target === source.id);
	const newNodeCount =
		request.variations.length + (request.mode === "image" ? 1 : 0);
	const newEdgeCount =
		request.variations.length *
		(request.mode === "image" ? 1 : incoming.length);
	if (graph.nodes.length + newNodeCount > 200)
		throw new Error("These variations would exceed the 200-node canvas limit.");
	if (graph.edges.length + newEdgeCount > 600)
		throw new Error(
			"These variations would exceed the 600-connection canvas limit.",
		);
	const contents = request.variations.map((variation, index) => {
		const error = validateModelSettings(
			{
				kind: "image",
				modelId: source.data.imageModel ?? defaultImageModel,
				aspectRatio: variation.aspectRatio,
			},
			request.mode === "image" ||
				incoming.some((edge) => edge.targetHandle === "reference"),
		);
		if (error) throw new Error(error);
		const content = [request.prompt.trim(), variation.instructions.trim()]
			.filter(Boolean)
			.join("\n\n");
		if (new TextEncoder().encode(content).length > maxInputBytes)
			throw new Error(
				`Variation ${index + 1} is too long. Shorten its prompt or instructions.`,
			);
		if (
			!content &&
			(request.mode === "image" ||
				!incoming.some((edge) => edge.targetHandle === "prompt"))
		)
			throw new Error(
				`Add a common prompt or instructions for variation ${index + 1}.`,
			);
		return content;
	});
	return { request, source, incoming, contents };
}

export function imageVariationsError(
	graph: CanvasDocument,
	request: ImageVariationsRequest,
): string | null {
	try {
		prepareImageVariations(graph, request);
		return null;
	} catch (cause) {
		return cause instanceof Error
			? cause.message
			: "Check the variation settings.";
	}
}

export function createImageVariations(
	graph: CanvasDocument,
	raw: ImageVariationsRequest,
) {
	const { request, source, incoming, contents } = prepareImageVariations(
		graph,
		raw,
	);
	const origin = source.position;
	const nodes: CanvasNode[] = [];
	const edges: CanvasDocument["edges"] = [];
	const targetIds: string[] = [];
	function place() {
		const directionX = origin.x > 95_000 ? -1 : 1;
		const directionY = origin.y > 50_000 ? -1 : 1;
		for (let slot = 0; slot < 1000; slot++) {
			const position = {
				x: origin.x + directionX * (1 + (slot % 2)) * 400,
				y: origin.y + directionY * Math.floor(slot / 2) * 440,
			};
			if (Math.abs(position.x) > 100_000 || Math.abs(position.y) > 100_000)
				continue;
			if (
				![...graph.nodes, ...nodes].some(
					(node) =>
						Math.abs(node.position.x - position.x) < 350 &&
						Math.abs(node.position.y - position.y) < 420,
				)
			)
				return position;
		}
		throw new Error(
			"There is not enough room near this node. Move it away from the canvas edge and try again.",
		);
	}
	let reference: CanvasNode | undefined;
	if (request.mode === "image") {
		reference = createCanvasNode("image", place());
		reference.data = {
			...reference.data,
			label: `${source.data.label.slice(0, 58)} · variation reference`,
			assetId: request.referenceAssetId,
			imageSource: "project",
			aspectRatio: source.data.aspectRatio,
		};
		nodes.push(reference);
	}
	for (const [index, variation] of request.variations.entries()) {
		const node = createCanvasNode("image", place());
		node.data = {
			...node.data,
			label: `${source.data.label.slice(0, 64)} · variation ${index + 1}`,
			content: contents[index] ?? "",
			imageSource: "generated",
			imageModel: source.data.imageModel ?? defaultImageModel,
			aspectRatio: variation.aspectRatio,
		};
		nodes.push(node);
		targetIds.push(node.id);
		if (reference)
			edges.push({
				id: crypto.randomUUID(),
				source: reference.id,
				target: node.id,
				sourceHandle: "output",
				targetHandle: "reference",
			});
		else
			for (const edge of incoming)
				edges.push({ ...edge, id: crypto.randomUUID(), target: node.id });
	}
	canvasDocumentSchema.parse({
		version: 1,
		nodes: [...graph.nodes, ...nodes],
		edges: [...graph.edges, ...edges],
	});
	return { nodes, edges, targetIds };
}
