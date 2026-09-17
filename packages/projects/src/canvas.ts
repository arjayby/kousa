import { z } from "zod";

export const nodeKinds = ["text", "image", "video", "speech"] as const;
export type NodeKind = (typeof nodeKinds)[number];
export const aspectRatios = ["1:1", "16:9", "9:16", "4:3"] as const;
export const nodeLabels: Record<NodeKind, string> = {
	text: "Text",
	image: "Image",
	video: "Video",
	speech: "Speech",
};
export type InputPort = {
	id: string;
	label: string;
	accepts: readonly NodeKind[];
};
export const inputPorts: Record<NodeKind, readonly InputPort[]> = {
	text: [{ id: "context", label: "Context", accepts: nodeKinds }],
	image: [
		{ id: "prompt", label: "Prompt", accepts: ["text"] },
		{ id: "reference", label: "Reference", accepts: ["image"] },
	],
	video: [
		{ id: "prompt", label: "Prompt", accepts: ["text"] },
		{ id: "image", label: "Image", accepts: ["image"] },
		{ id: "video", label: "Video", accepts: ["video"] },
		{ id: "audio", label: "Audio", accepts: ["speech"] },
	],
	speech: [{ id: "script", label: "Script", accepts: ["text"] }],
};

const nodeDataSchema = z.object({
	label: z.string().max(80),
	textModel: z.string().max(120).optional(),
	assetId: z.uuid().nullable().optional(),
	content: z.string().max(20_000),
	aspectRatio: z.enum(aspectRatios),
	duration: z.union([z.literal(5), z.literal(10)]),
	voiceDirection: z.string().max(500),
});
export const canvasNodeSchema = z.object({
	id: z.uuid(),
	type: z.enum(nodeKinds),
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
	sourceHandle: z.literal("output"),
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
	if (connection.sourceHandle !== "output")
		return "Connect from an output handle.";
	const port = inputPorts[target.type].find(
		(port) => port.id === connection.targetHandle,
	);
	if (!port?.accepts.includes(source.type))
		return "These input and output types do not match.";
	const edges = graph.edges.filter((edge) => edge.id !== ignoreEdgeId);
	if (
		edges.some(
			(edge) => edge.target === target.id && edge.targetHandle === port.id,
		)
	)
		return "This input already has a connection. Remove it first.";
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

export function canvasDraftKey(userId: string, projectId: string) {
	return `kousa:canvas:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
}
