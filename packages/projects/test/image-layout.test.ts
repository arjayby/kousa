import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	type CanvasDocument,
	createCanvasNode,
	emptyCanvas,
} from "../src/canvas";
import {
	copyCanvasSelection,
	pasteCanvasSelection,
} from "../src/canvas-clipboard";
import {
	createCanvasDocumentModel,
	seedCanvasDocument,
} from "../src/canvas-document";
import {
	clampLayoutRect,
	createImageLayout,
	createTextLayer,
	fitLayoutImage,
	imageLayoutSchema,
	layoutAssetIds,
	wrapLayoutText,
} from "../src/image-layout";
import { copyTemplateDocument } from "../src/template-document";

function fixture() {
	const node = createCanvasNode("image", { x: 0, y: 0 });
	const layout = createImageLayout(crypto.randomUUID(), 1024, 1024);
	layout.layers = [
		createTextLayer(),
		{
			id: crypto.randomUUID(),
			kind: "logo",
			assetId: crypto.randomUUID(),
			x: 0.7,
			y: 0.8,
			width: 0.2,
			height: 0.1,
			opacity: 0.8,
		},
	];
	node.data.imageLayout = layout;
	return {
		node,
		layout,
		document: { version: 1, nodes: [node], edges: [] } as CanvasDocument,
	};
}

describe("editable image layouts", () => {
	it("bounds export dimensions, layer count, IDs, coordinates and asset references", () => {
		const { layout } = fixture();
		expect(imageLayoutSchema.safeParse(layout).success).toBe(true);
		for (const invalid of [
			{ ...layout, width: 4097 },
			{ ...layout, height: 0 },
			{ ...layout, backgroundAssetId: "https://external.test/photo.png" },
			{ ...layout, layers: Array.from({ length: 21 }, createTextLayer) },
			{ ...layout, layers: [layout.layers[0], layout.layers[0]] },
			{ ...layout, layers: [{ ...layout.layers[0], x: 0.9, width: 0.2 }] },
			{
				...layout,
				layers: [{ ...layout.layers[0], fontSize: Number.POSITIVE_INFINITY }],
			},
		])
			expect(imageLayoutSchema.safeParse(invalid).success).toBe(false);
		expect(createImageLayout(null, 8000, 4000)).toMatchObject({
			width: 4096,
			height: 2048,
		});
	});
	it("keeps resized and moved layers inside the artboard", () => {
		expect(clampLayoutRect({ x: -0.1, y: 1, width: 2, height: -0.1 })).toEqual({
			x: 0,
			y: 0.98,
			width: 1,
			height: 0.02,
		});
	});
	it("fits without distorting and fills by cropping around the center", () => {
		expect(fitLayoutImage(200, 100, 100, 100, "contain")).toEqual({
			x: 0,
			y: 25,
			width: 100,
			height: 50,
		});
		expect(fitLayoutImage(200, 100, 100, 100, "cover")).toEqual({
			x: -50,
			y: 0,
			width: 200,
			height: 100,
		});
	});
	it("wraps words, preserves blank lines, and splits long words without splitting Unicode code points", () => {
		const measure = (text: string) => Array.from(text).length;
		expect(wrapLayoutText("Fresh look\n\nabcdefghij", 5, measure)).toEqual([
			"Fresh",
			"look",
			"",
			"abcde",
			"fghij",
		]);
		expect(wrapLayoutText("😀😀😀", 2, measure)).toEqual(["😀😀", "😀"]);
	});
	it("persists saved layers, syncs and undoes a layout while preserving concurrent prompt edits", () => {
		const { document, node, layout } = fixture();
		const first = createCanvasDocumentModel(new Y.Doc());
		const second = createCanvasDocumentModel(new Y.Doc());
		Y.applyUpdate(first.doc, seedCanvasDocument(document));
		Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));
		const updated = structuredClone(document);
		const changedLayout = updated.nodes[0]?.data.imageLayout;
		if (!changedLayout) throw new Error("Missing fixture layout");
		changedLayout.layers.push(createTextLayer());
		first.apply(document, updated);
		second.editText(node.id, "content", (text) =>
			text.insert(0, "Remote prompt"),
		);
		const merge = () => {
			Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc));
			Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));
		};
		merge();
		expect(
			second.read().document.nodes[0]?.data.imageLayout?.layers,
		).toHaveLength(3);
		first.history.undo();
		merge();
		expect(second.read().document.nodes[0]?.data).toMatchObject({
			imageLayout: layout,
			content: "Remote prompt",
		});
		first.history.redo();
		merge();
		expect(
			second.read().document.nodes[0]?.data.imageLayout?.layers,
		).toHaveLength(3);
		expect(second.read().rejected).toBe(0);
		first.destroy();
		second.destroy();
		first.doc.destroy();
		second.doc.destroy();
	});
	it("retains images within a project and strips private IDs from templates and cross-project paste", () => {
		const { document, node, layout } = fixture();
		const project = crypto.randomUUID();
		const clipboard = copyCanvasSelection(document, [node.id], project);
		const same = pasteCanvasSelection(clipboard, document, project);
		expect(same.nodes[0]?.data.imageLayout).toEqual(layout);
		for (const copy of [
			copyTemplateDocument(document),
			pasteCanvasSelection(clipboard, emptyCanvas(), crypto.randomUUID()),
		]) {
			const saved = copy.nodes[0]?.data.imageLayout;
			expect(saved?.layers).toHaveLength(2);
			expect(saved?.layers[0]).toEqual(layout.layers[0]);
			expect(layoutAssetIds(saved)).toEqual([]);
		}
		expect(layoutAssetIds(node.data.imageLayout)).toHaveLength(2);
	});
});
