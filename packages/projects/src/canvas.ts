import { z } from "zod";
import { imageLayoutSchema } from "./image-layout";

export const nodeKinds = ["text", "image", "video", "audio"] as const;
export type NodeKind = (typeof nodeKinds)[number];

// Audio is the media node. Speech remains the current generation operation and
// the persisted run kind, so old jobs, receipts, and history keep their identity.
export function nodeGenerationKind(kind: NodeKind) {
	return kind === "audio" ? "speech" : kind;
}
export function generationNodeKind(
	kind: ReturnType<typeof nodeGenerationKind>,
): NodeKind {
	return kind === "speech" ? "audio" : kind;
}
export const aspectRatios = ["1:1", "16:9", "9:16", "4:3"] as const;
export const nodeLabels: Record<NodeKind, string> = {
	text: "Text",
	image: "Image",
	video: "Video",
	audio: "Audio",
};
export type InputPort = {
	id: string;
	label: string;
	accepts: readonly NodeKind[];
	maxConnections?: number;
};
export const inputPorts: Record<NodeKind, readonly InputPort[]> = {
	text: [
		{ id: "context", label: "Context", accepts: nodeKinds, maxConnections: 8 },
	],
	image: [
		{ id: "prompt", label: "Prompt", accepts: ["text"] },
		{
			id: "reference",
			label: "Reference",
			accepts: ["image"],
			maxConnections: 4,
		},
	],
	video: [
		{ id: "prompt", label: "Prompt", accepts: ["text"] },
		{ id: "image", label: "Starting frame", accepts: ["image"] },
		{ id: "lastFrame", label: "Last frame", accepts: ["image"] },
		{
			id: "reference",
			label: "Reference images",
			accepts: ["image"],
			maxConnections: 4,
		},
		{ id: "video", label: "Reference video", accepts: ["video"] },
		{ id: "audioReference", label: "Reference audio", accepts: ["audio"] },
		{ id: "audio", label: "Clip soundtrack", accepts: ["audio"] },
	],
	audio: [{ id: "script", label: "Script", accepts: ["text"] }],
};

const nodeDataSchema = z.object({
	imageLayout: imageLayoutSchema.optional(),
	selectedRunId: z.uuid().nullable().optional(),
	label: z.string().max(80),
	textModel: z.string().max(120).optional(),
	imageModel: z.string().max(120).optional(),
	imageQuality: z.enum(["low", "medium", "high"]).optional(),
	videoModel: z.string().max(120).optional(),
	speechModel: z.string().max(120).optional(),
	voiceId: z.string().max(120).optional(),
	imageSource: z.enum(["generated", "project"]).optional(),
	mediaSource: z.enum(["generated", "project"]).optional(),
	clipSettings: z
		.object({
			narrationStartMs: z.number().int().min(0).max(11_999),
			narrationVolume: z.number().min(0).max(2),
			videoVolume: z.number().min(0).max(2),
		})
		.optional(),
	assetId: z.uuid().nullable().optional(),
	content: z.string().max(20_000),
	aspectRatio: z.enum(aspectRatios),
	duration: z.number().int().min(1).max(12),
	voiceDirection: z.string().max(500),
});
export const canvasNodeSchema = z.object({
	id: z.uuid(),
	// Normalize legacy canvases, templates, clipboard payloads, and Yjs records.
	type: z
		.enum([...nodeKinds, "speech"])
		.transform((kind) => (kind === "speech" ? "audio" : kind)),
	position: z.object({
		x: z.number().min(-100_000).max(100_000),
		y: z.number().min(-100_000).max(100_000),
	}),
	data: nodeDataSchema,
});
export const canvasEdgeSchema = z.object({
	id: z.uuid(),
	source: z.uuid(),
	target: z.uuid(),
	sourceHandle: z.enum(["output", "lastFrame", "audio"]),
	targetHandle: z.string().min(1).max(30),
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasDocument = {
	version: 1;
	nodes: CanvasNode[];
	edges: CanvasEdge[];
};
export type CanvasConnection = Pick<
	CanvasEdge,
	"source" | "target" | "sourceHandle" | "targetHandle"
>;

export function emptyCanvas(): CanvasDocument {
	return { version: 1, nodes: [], edges: [] };
}

export function createCanvasNode(
	type: NodeKind,
	position: CanvasNode["position"],
): CanvasNode {
	return {
		id: crypto.randomUUID(),
		type,
		position,
		data: {
			label: nodeLabels[type],
			content: "",
			aspectRatio: type === "video" ? "16:9" : "1:1",
			duration: 5,
			voiceDirection: "",
		},
	};
}

export function connectionError(
	graph: Pick<CanvasDocument, "nodes" | "edges">,
	connection: CanvasConnection,
	ignoreEdgeId?: string,
): string | null {
	const source = graph.nodes.find((node) => node.id === connection.source);
	const target = graph.nodes.find((node) => node.id === connection.target);
	if (!source || !target) return "Both nodes must exist.";
	if (source.id === target.id) return "A node cannot connect to itself.";
	const outputKind = sourceOutputKind(source.type, connection.sourceHandle);
	if (!outputKind) return "Connect from an available output handle.";
	const port = inputPorts[target.type].find(
		(port) => port.id === connection.targetHandle,
	);
	if (!port)
		return `${nodeLabels[target.type]} has no ${connection.targetHandle} input.`;
	if (!port.accepts.includes(outputKind))
		return `${nodeLabels[source.type]} output cannot connect to ${nodeLabels[target.type]} ${port.label}. This input accepts ${port.accepts.map((kind) => nodeLabels[kind]).join(" or ")}.`;
	const edges = graph.edges.filter((edge) => edge.id !== ignoreEdgeId);
	if (
		edges.filter(
			(edge) => edge.target === target.id && edge.targetHandle === port.id,
		).length >= (port.maxConnections ?? 1)
	)
		return "This input already has a connection. Remove it first.";
	if (
		edges.some(
			(edge) =>
				edge.source === source.id &&
				edge.sourceHandle === connection.sourceHandle &&
				edge.target === target.id &&
				edge.targetHandle === port.id,
		)
	)
		return "This output is already connected to this input.";
	const outgoing = new Map<string, string[]>();
	for (const edge of edges)
		outgoing.set(edge.source, [
			...(outgoing.get(edge.source) ?? []),
			edge.target,
		]);
	const pending = [target.id];
	const visited = new Set<string>();
	while (pending.length) {
		const id = pending.pop();
		if (!id || visited.has(id)) continue;
		if (id === source.id) return "This connection would create a loop.";
		visited.add(id);
		pending.push(...(outgoing.get(id) ?? []));
	}
	return null;
}

export function removeCanvasElements(
	graph: CanvasDocument,
	nodeIds: readonly string[],
	edgeIds: readonly string[],
): CanvasDocument {
	const removedNodes = new Set(nodeIds);
	const removedEdges = new Set(edgeIds);
	return {
		...graph,
		nodes: graph.nodes.filter((node) => !removedNodes.has(node.id)),
		edges: graph.edges.filter(
			(edge) =>
				!removedEdges.has(edge.id) &&
				!removedNodes.has(edge.source) &&
				!removedNodes.has(edge.target),
		),
	};
}

// Validate storage before rendering it, including referential integrity and cycles.
export const canvasDocumentSchema = z
	.object({
		version: z.literal(1),
		nodes: z.array(canvasNodeSchema).max(200),
		edges: z.array(canvasEdgeSchema).max(600),
	})
	.superRefine((graph, ctx) => {
		const nodeIds = new Set(graph.nodes.map((node) => node.id));
		const edgeIds = new Set(graph.edges.map((edge) => edge.id));
		if (
			nodeIds.size !== graph.nodes.length ||
			edgeIds.size !== graph.edges.length
		) {
			ctx.addIssue({ code: "custom", message: "Duplicate canvas IDs." });
			return;
		}
		const accepted: CanvasEdge[] = [];
		for (const edge of graph.edges) {
			const message = connectionError(
				{ nodes: graph.nodes, edges: accepted },
				edge,
			);
			if (message) {
				ctx.addIssue({ code: "custom", message });
				return;
			}
			accepted.push(edge);
		}
	});

export function canvasDraftKey(userId: string, canvasId: string) {
	return `kousa:canvas:v1:${encodeURIComponent(userId)}:${encodeURIComponent(canvasId)}`;
}

export function imageOutputAssetId(
	data: Pick<CanvasNode["data"], "imageSource" | "assetId" | "selectedRunId">,
	generatedAssetId?: string | null,
) {
	const source = data.imageSource ?? (data.assetId ? "project" : "generated");
	if (source === "generated" && data.selectedRunId)
		return generatedAssetId ?? null;
	return source === "generated"
		? (generatedAssetId ?? data.assetId)
		: data.assetId;
}

export function sourceOutputKind(
	kind: NodeKind,
	handle: string,
): NodeKind | null {
	if (handle === "output") return kind;
	if (kind === "video" && handle === "lastFrame") return "image";
	if (kind === "video" && handle === "audio") return "audio";
	return null;
}
