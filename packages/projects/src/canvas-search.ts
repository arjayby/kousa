import { type CanvasNode, nodeLabels } from "./canvas";

function excerpt(text: string, terms: string[]) {
	const lower = text.toLowerCase();
	const matches = terms
		.map((term) => lower.indexOf(term))
		.filter((at) => at >= 0);
	const start = Math.max(
		0,
		Math.min(
			(matches.length ? Math.min(...matches) : 0) - 40,
			text.length - 160,
		),
	);
	const end = start + 160;
	return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Search the complete graph, independent of viewport visibility or selection. */
export function searchCanvasNodes(nodes: readonly CanvasNode[], query: string) {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return nodes.flatMap((node) => {
		const prompt = [
			node.data.content,
			node.type === "speech" ? node.data.voiceDirection : "",
		]
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		const searchable =
			`${node.data.label} ${nodeLabels[node.type]} ${prompt}`.toLowerCase();
		return terms.every((term) => searchable.includes(term))
			? [{ node, excerpt: excerpt(prompt, terms) }]
			: [];
	});
}
