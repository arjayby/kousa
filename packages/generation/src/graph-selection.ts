import type { CanvasDocument } from "@kousa/projects/canvas";

type Graph = Pick<CanvasDocument, "nodes" | "edges">;

// Both the output picker and execution planner must follow these same edges.
export function graphDependencies(graph: Graph) {
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const dependencies = new Map<string, string[]>(
		graph.nodes.map((node) => [node.id, []]),
	);
	for (const edge of [...graph.edges].sort((a, b) =>
		a.id.localeCompare(b.id),
	)) {
		const target = nodes.get(edge.target);
		const source = nodes.get(edge.source);
		// Composition uses already saved speech; video generation does not depend on it.
		if (
			target?.type === "video" &&
			edge.targetHandle === "audio" &&
			source?.type === "speech"
		)
			continue;
		// Video consumes the fixed asset, not a new generation of its source image.
		if (
			target?.type === "video" &&
			edge.targetHandle === "image" &&
			source?.type === "image" &&
			(source.data.imageSource ??
				(source.data.assetId ? "project" : "generated")) === "project"
		)
			continue;
		dependencies.get(edge.target)?.push(edge.source);
	}
	return dependencies;
}

export function selectGraphOutputs(graph: Graph, selected: string[]) {
	const dependencies = graphDependencies(graph);
	const candidates = [...new Set(selected)].filter((id) =>
		dependencies.has(id),
	);
	const ancestors = new Map<string, Set<string>>();
	for (const id of candidates) {
		const included = new Set<string>();
		const pending = [...(dependencies.get(id) ?? [])];
		while (pending.length) {
			const source = pending.pop();
			if (!source || source === id || included.has(source)) continue;
			included.add(source);
			pending.push(...(dependencies.get(source) ?? []));
		}
		ancestors.set(id, included);
	}
	const targets = candidates.filter(
		(id) =>
			!candidates.some(
				(other) =>
					ancestors.get(other)?.has(id) &&
					// Keep cyclic selections visible so the planner can report the cycle.
					!ancestors.get(id)?.has(other),
			),
	);
	const included = new Set<string>();
	for (const target of targets) {
		for (const ancestor of ancestors.get(target) ?? []) included.add(ancestor);
	}
	for (const target of targets) included.delete(target);
	return { targets, included };
}
