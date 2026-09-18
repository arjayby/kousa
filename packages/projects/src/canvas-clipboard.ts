import { z } from "zod";
import {
	type CanvasDocument,
	type CanvasNode,
	canvasDocumentSchema,
	nodeLabels,
} from "./canvas";
import { copyTemplateDocument } from "./template-document";

const clipboardSchema = z.object({
	format: z.literal("kousa/canvas-selection"),
	version: z.literal(1),
	projectId: z.uuid(),
	document: canvasDocumentSchema.refine((value) => value.nodes.length > 0),
});
export type CanvasClipboard = z.infer<typeof clipboardSchema>;
// Bound parsing before JSON/schema validation, including escaped prompt text.
const maxClipboardLength = 25_000_000;

export function copyCanvasSelection(
	document: CanvasDocument,
	nodeIds: readonly string[],
	projectId: string,
): CanvasClipboard {
	const selected = new Set(nodeIds);
	return clipboardSchema.parse({
		format: "kousa/canvas-selection",
		version: 1,
		projectId,
		document: {
			version: 1,
			nodes: document.nodes.filter((node) => selected.has(node.id)),
			edges: document.edges.filter(
				(edge) => selected.has(edge.source) && selected.has(edge.target),
			),
		},
	});
}

export function parseCanvasClipboard(text: string): CanvasClipboard | null {
	if (text.length > maxClipboardLength) return null;
	try {
		const result = clipboardSchema.safeParse(JSON.parse(text));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

// Return only the insertion. Callers append it in one shared-document edit.
export function pasteCanvasSelection(
	clipboard: CanvasClipboard,
	target: CanvasDocument,
	projectId: string,
	anchor?: CanvasNode["position"],
): CanvasDocument {
	const { document: source } = clipboardSchema.parse(clipboard);
	if (target.nodes.length + source.nodes.length > 200)
		throw new Error("This selection would exceed the 200-node canvas limit.");
	if (target.edges.length + source.edges.length > 600)
		throw new Error(
			"This selection would exceed the 600-connection canvas limit.",
		);
	const copy = copyTemplateDocument(source);
	const minX = Math.min(...source.nodes.map((node) => node.position.x));
	const minY = Math.min(...source.nodes.map((node) => node.position.y));
	const maxX = Math.max(...source.nodes.map((node) => node.position.x));
	const maxY = Math.max(...source.nodes.map((node) => node.position.y));
	// Clamp the translation as a group so spacing survives at the canvas edges.
	const dx = Math.max(
		-100_000 - minX,
		Math.min(100_000 - maxX, anchor ? anchor.x - minX : 48),
	);
	const dy = Math.max(
		-100_000 - minY,
		Math.min(100_000 - maxY, anchor ? anchor.y - minY : 48),
	);
	for (const [index, node] of copy.nodes.entries()) {
		const original = source.nodes[index];
		if (!original) continue;
		node.position.x += dx;
		node.position.y += dy;
		node.data.label = `${node.data.label || nodeLabels[node.type]} copy`.slice(
			0,
			80,
		);
		if (clipboard.projectId !== projectId || !original.data.assetId) continue;
		const sourceMode =
			node.type === "image"
				? original.data.imageSource
				: original.data.mediaSource;
		if (node.type !== "text" && (sourceMode ?? "project") === "project") {
			node.data.assetId = original.data.assetId;
			if (node.type === "image") node.data.imageSource = "project";
			else node.data.mediaSource = "project";
		}
	}
	return canvasDocumentSchema.parse(copy);
}
