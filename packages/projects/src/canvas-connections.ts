import {
	type CanvasConnection,
	type CanvasDocument,
	type CanvasEdge,
	connectionError,
	inputPorts,
} from "./canvas";

type Graph = Pick<CanvasDocument, "nodes" | "edges">;

// Validate the final graph, so replacement and reconnection are one edit.
export function planConnection(
	graph: Graph,
	connection: CanvasConnection,
	reconnectId?: string,
) {
	const previous = reconnectId
		? graph.edges.find((edge) => edge.id === reconnectId)
		: undefined;
	const target = graph.nodes.find((node) => node.id === connection.target);
	const multiple =
		target &&
		(inputPorts[target.type].find((port) => port.id === connection.targetHandle)
			?.maxConnections ?? 1) > 1;
	const occupied = multiple
		? undefined
		: graph.edges.find(
				(edge) =>
					edge.target === connection.target &&
					edge.targetHandle === connection.targetHandle &&
					edge.id !== reconnectId,
			);
	const removed = graph.edges.filter(
		(edge) => edge.id === reconnectId || edge.id === occupied?.id,
	);
	const edges = graph.edges.filter((edge) => !removed.includes(edge));
	const error =
		reconnectId && !previous
			? "This connection was removed. Close this preview and try again."
			: (connectionError({ ...graph, edges }, connection) ??
				(edges.length >= 600
					? "This draft can hold up to 600 connections."
					: null));
	return { error, edges, removed, occupied, previous };
}

export function connectionDependencies(graph: Graph, selected: string[]) {
	function walk(direction: "upstream" | "downstream") {
		const nodes = new Set<string>();
		const edges = new Set<string>();
		const pending = [...selected];
		const visited = new Set<string>();
		const adjacent = new Map<string, CanvasEdge[]>();
		for (const edge of graph.edges) {
			const id = direction === "upstream" ? edge.target : edge.source;
			adjacent.set(id, [...(adjacent.get(id) ?? []), edge]);
		}
		while (pending.length) {
			const id = pending.pop();
			if (!id || visited.has(id)) continue;
			visited.add(id);
			for (const edge of adjacent.get(id) ?? []) {
				const next = direction === "upstream" ? edge.source : edge.target;
				nodes.add(next);
				edges.add(edge.id);
				pending.push(next);
			}
		}
		for (const id of selected) nodes.delete(id);
		return { nodes, edges };
	}
	return { upstream: walk("upstream"), downstream: walk("downstream") };
}
