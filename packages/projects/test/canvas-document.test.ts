import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	canvasDocumentSchema,
	createCanvasNode,
	emptyCanvas,
} from "../src/canvas";
import {
	createCanvasDocumentModel,
	graphKeys,
	readCanvasDocument,
	seedCanvasDocument,
} from "../src/canvas-document";

function fixture() {
	const text = createCanvasNode("text", { x: 0, y: 0 });
	text.data.content = "Hello world";
	const image = createCanvasNode("image", { x: 400, y: 0 });
	const graph = { ...emptyCanvas(), nodes: [text, image] };
	const seed = seedCanvasDocument(graph);
	const a = new Y.Doc();
	const b = new Y.Doc();
	Y.applyUpdate(a, seed);
	Y.applyUpdate(b, seed);
	return {
		text,
		image,
		seed,
		a,
		b,
		first: createCanvasDocumentModel(a),
		second: createCanvasDocumentModel(b),
	};
}
function merge(a: Y.Doc, b: Y.Doc) {
	const left = Y.encodeStateAsUpdate(a);
	const right = Y.encodeStateAsUpdate(b);
	Y.applyUpdate(a, right);
	Y.applyUpdate(b, left);
}

describe("portable shared canvas document", () => {
	it("syncs the text model without losing concurrent prompt edits and can undo it", () => {
		const { a, b, text, first, second } = fixture();
		const before = first.read().document;
		first.apply(before, {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === text.id
					? {
							...node,
							data: { ...node.data, textModel: "google/gemini-2.5-flash-lite" },
						}
					: node,
			),
		});
		second.editText(text.id, "content", (value) =>
			value.insert(value.length, "!"),
		);
		merge(a, b);
		expect(
			second.read().document.nodes.find((node) => node.id === text.id)?.data,
		).toMatchObject({
			textModel: "google/gemini-2.5-flash-lite",
			content: "Hello world!",
		});
		first.history.undo();
		merge(a, b);
		expect(
			second.read().document.nodes.find((node) => node.id === text.id)?.data,
		).toMatchObject({ content: "Hello world!" });
		expect(
			second.read().document.nodes.find((node) => node.id === text.id)?.data
				.textModel,
		).toBeUndefined();
	});
	it("imports exactly once when an identical seed is retried", () => {
		const { a, seed } = fixture();
		Y.applyUpdate(a, seed);
		Y.applyUpdate(a, seed);
		expect(readCanvasDocument(a).document.nodes).toHaveLength(2);
		expect(
			readCanvasDocument(a).document.nodes.find((node) => node.type === "text")
				?.data.content,
		).toBe("Hello world");
	});
	it("merges simultaneous movement and prompt changes on the same node", () => {
		const { a, b, text, first, second } = fixture();
		const before = first.read().document;
		first.apply(before, {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === text.id ? { ...node, position: { x: 50, y: 80 } } : node,
			),
		});
		second.editText(text.id, "content", (value) =>
			value.insert(value.length, "!"),
		);
		merge(a, b);
		expect(first.read()).toEqual(second.read());
		expect(
			first.read().document.nodes.find((node) => node.id === text.id),
		).toMatchObject({
			position: { x: 50, y: 80 },
			data: { content: "Hello world!" },
		});
	});
	it("merges offline typing at different positions character by character", () => {
		const { a, b, text, first, second } = fixture();
		first.editText(text.id, "content", (value) => value.insert(0, "A "));
		second.editText(text.id, "content", (value) =>
			value.insert(value.length, " B"),
		);
		merge(a, b);
		expect(first.getText(text.id, "content")?.toString()).toBe(
			"A Hello world B",
		);
		expect(first.read()).toEqual(second.read());
	});
	it("undo only affects the local user's text edits", () => {
		const { a, b, text, first, second } = fixture();
		first.editText(text.id, "content", (value) => value.insert(0, "A "));
		second.editText(text.id, "content", (value) =>
			value.insert(value.length, " B"),
		);
		merge(a, b);
		first.history.undo();
		merge(a, b);
		expect(second.getText(text.id, "content")?.toString()).toBe(
			"Hello world B",
		);
	});
	it("does not undo another user's position while undoing a local prompt", () => {
		const { a, b, text, first, second } = fixture();
		first.editText(text.id, "content", (value) => value.insert(0, "A "));
		const before = second.read().document;
		second.apply(before, {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === text.id ? { ...node, position: { x: 70, y: 80 } } : node,
			),
		});
		merge(a, b);
		first.history.undo();
		merge(a, b);
		expect(
			second.read().document.nodes.find((node) => node.id === text.id),
		).toMatchObject({
			position: { x: 70, y: 80 },
			data: { content: "Hello world" },
		});
	});
	it("deletion wins over concurrent field edits and hides orphaned edges", () => {
		const { a, b, text, image, first, second } = fixture();
		const before = first.read().document;
		first.apply(before, {
			...before,
			nodes: before.nodes.filter((node) => node.id !== text.id),
		});
		second.editText(text.id, "content", (value) => value.insert(0, "offline"));
		const other = second.read().document;
		second.apply(other, {
			...other,
			edges: [
				{
					id: crypto.randomUUID(),
					source: text.id,
					target: image.id,
					sourceHandle: "output",
					targetHandle: "prompt",
				},
			],
		});
		merge(a, b);
		expect(first.read()).toEqual(second.read());
		expect(first.read().document.nodes).toHaveLength(1);
		expect(first.read().document.edges).toHaveLength(0);
		first.history.undo();
		merge(a, b);
		expect(first.read().document.edges).toHaveLength(1);
	});
	it("converges to one connection for a concurrently connected input", () => {
		const { a, b, text, image, first, second } = fixture();
		for (const model of [first, second]) {
			const before = model.read().document;
			model.apply(before, {
				...before,
				edges: [
					{
						id: crypto.randomUUID(),
						source: text.id,
						target: image.id,
						sourceHandle: "output",
						targetHandle: "prompt",
					},
				],
			});
		}
		merge(a, b);
		expect(first.read()).toEqual(second.read());
		expect(first.read().document.edges).toHaveLength(1);
		expect(first.read().rejected).toBe(1);
	});
	it("projects a valid DAG when concurrent valid operations form a cycle", () => {
		const { a, b, text, first, second } = fixture();
		const secondText = createCanvasNode("text", { x: 0, y: 300 });
		let before = first.read().document;
		first.apply(before, { ...before, nodes: [...before.nodes, secondText] });
		merge(a, b);
		for (const [model, source, target] of [
			[first, text.id, secondText.id],
			[second, secondText.id, text.id],
		] as const) {
			before = model.read().document;
			model.apply(before, {
				...before,
				edges: [
					{
						id: crypto.randomUUID(),
						source,
						target,
						sourceHandle: "output",
						targetHandle: "context",
					},
				],
			});
		}
		merge(a, b);
		expect(first.read()).toEqual(second.read());
		expect(first.read().document.edges).toHaveLength(1);
		expect(canvasDocumentSchema.safeParse(first.read().document).success).toBe(
			true,
		);
	});
	it("rejects malformed shared data without crashing the canvas", () => {
		const { a } = fixture();
		a.getMap(graphKeys.nodes).set("bad", { data: "no" });
		a.getMap(graphKeys.edges).set("bad", "invalid");
		const result = readCanvasDocument(a);
		expect(result.rejected).toBe(2);
		expect(result.document.nodes).toHaveLength(2);
	});
	it("exports and restores the same graph in a fresh Yjs document", () => {
		const { a, text, first } = fixture();
		first.editText(text.id, "content", (value) => value.insert(0, "Portable "));
		const restored = new Y.Doc();
		Y.applyUpdate(restored, Y.encodeStateAsUpdate(a));
		expect(readCanvasDocument(restored)).toEqual(first.read());
	});
});
