import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	canvasDocumentSchema,
	createCanvasNode,
	emptyCanvas,
	imageOutputAssetId,
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
	it("reads a legacy speech CRDT as audio and preserves shared editing", () => {
		const audio = createCanvasNode("audio", { x: 0, y: 0 });
		audio.data.label = "Saved narration";
		audio.data.content = "Original script";
		audio.data.selectedRunId = crypto.randomUUID();
		const doc = new Y.Doc();
		Y.applyUpdate(
			doc,
			seedCanvasDocument({ ...emptyCanvas(), nodes: [audio] }),
		);
		const raw = doc.getMap<Y.Map<unknown>>(graphKeys.nodes).get(audio.id);
		if (!raw) throw new Error("Missing shared node");
		raw.set("type", "speech");
		const model = createCanvasDocumentModel(doc);
		expect(model.read()).toEqual({
			document: { ...emptyCanvas(), nodes: [audio] },
			rejected: 0,
		});
		model.editText(audio.id, "content", (text) =>
			text.insert(text.length, " edited"),
		);
		expect(model.read().document.nodes[0]).toMatchObject({
			type: "audio",
			data: {
				content: "Original script edited",
				selectedRunId: audio.data.selectedRunId,
			},
		});
		model.history.undo();
		expect(model.read().document.nodes[0]?.data.content).toBe(
			"Original script",
		);
		doc.destroy();
	});
	it("shares, restores, and removes image attachments without losing concurrent edits", () => {
		const { a, b, image, first, second } = fixture();
		const assetId = crypto.randomUUID();
		const before = first.read().document;
		first.apply(before, {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === image.id
					? { ...node, data: { ...node.data, assetId } }
					: node,
			),
		});
		second.editText(image.id, "content", (value) =>
			value.insert(0, "Reference"),
		);
		merge(a, b);
		expect(
			second.read().document.nodes.find((node) => node.id === image.id)?.data,
		).toMatchObject({ assetId, content: "Reference" });
		const restored = new Y.Doc();
		Y.applyUpdate(restored, seedCanvasDocument(first.read().document));
		expect(
			readCanvasDocument(restored).document.nodes.find(
				(node) => node.id === image.id,
			)?.data.assetId,
		).toBe(assetId);
		const attached = first.read().document;
		first.apply(attached, {
			...attached,
			nodes: attached.nodes.map((node) =>
				node.id === image.id
					? { ...node, data: { ...node.data, assetId: null } }
					: node,
			),
		});
		merge(a, b);
		expect(
			second.read().document.nodes.find((node) => node.id === image.id)?.data,
		).toMatchObject({ assetId: null, content: "Reference" });
		first.history.undo();
		merge(a, b);
		expect(
			second.read().document.nodes.find((node) => node.id === image.id)?.data
				.assetId,
		).toBe(assetId);
		restored.destroy();
	});
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

it("syncs image generation settings and output selection independently of concurrent prompts", () => {
	const { a, b, image, first, second } = fixture();
	const assetId = crypto.randomUUID();
	const generatedId = crypto.randomUUID();
	const before = first.read().document;
	first.apply(before, {
		...before,
		nodes: before.nodes.map((node) =>
			node.id === image.id
				? {
						...node,
						data: {
							...node.data,
							assetId,
							imageModel: "bfl/flux-2-klein-4b",
							imageSource: "generated" as const,
						},
					}
				: node,
		),
	});
	second.editText(image.id, "content", (value) => value.insert(0, "A lantern"));
	merge(a, b);
	const data = second
		.read()
		.document.nodes.find((node) => node.id === image.id)?.data;
	if (!data) throw new Error("Missing image node");
	expect(data).toMatchObject({
		imageModel: "bfl/flux-2-klein-4b",
		imageSource: "generated",
		assetId,
		content: "A lantern",
	});
	expect(imageOutputAssetId(data, generatedId)).toBe(generatedId);
	expect(imageOutputAssetId(data)).toBe(assetId);
	expect(
		imageOutputAssetId({ ...data, imageSource: "project" }, generatedId),
	).toBe(assetId);
	expect(
		imageOutputAssetId(
			{ ...data, imageSource: "project", assetId: null },
			generatedId,
		),
	).toBeNull();
	const restored = new Y.Doc();
	Y.applyUpdate(restored, seedCanvasDocument(first.read().document));
	expect(readCanvasDocument(restored).document).toEqual(first.read().document);
	first.history.undo();
	merge(a, b);
	expect(
		second.read().document.nodes.find((node) => node.id === image.id)?.data,
	).toMatchObject({ content: "A lantern" });
	expect(
		second.read().document.nodes.find((node) => node.id === image.id)?.data
			.imageSource,
	).toBeUndefined();
	restored.destroy();
});

it("persists speech model and voice changes while preserving concurrent shared scripts", () => {
	const node = createCanvasNode("audio", { x: 0, y: 0 });
	node.data.speechModel = "model-a";
	node.data.voiceId = "voice-a";
	const seed = seedCanvasDocument({ ...emptyCanvas(), nodes: [node] });
	const a = new Y.Doc();
	const b = new Y.Doc();
	Y.applyUpdate(a, seed);
	Y.applyUpdate(b, seed);
	const first = createCanvasDocumentModel(a);
	const second = createCanvasDocumentModel(b);
	const before = first.read().document;
	first.apply(before, {
		...before,
		nodes: before.nodes.map((n) => ({
			...n,
			data: { ...n.data, voiceId: "voice-b", speechModel: "model-b" },
		})),
	});
	second.editText(node.id, "content", (text) => text.insert(0, "Hello"));
	second.editText(node.id, "voiceDirection", (text) => text.insert(0, "Calm"));
	merge(a, b);
	expect(second.read().document.nodes[0]?.data).toMatchObject({
		voiceId: "voice-b",
		speechModel: "model-b",
		content: "Hello",
		voiceDirection: "Calm",
	});
	const restored = new Y.Doc();
	Y.applyUpdate(restored, seedCanvasDocument(second.read().document));
	expect(readCanvasDocument(restored).document).toEqual(first.read().document);
	first.destroy();
	second.destroy();
	a.destroy();
	b.destroy();
	restored.destroy();
});

it("persists video model, duration and aspect ratio without losing concurrent prompt edits", () => {
	const node = createCanvasNode("video", { x: 0, y: 0 });
	node.data.videoModel = "model-a";
	node.data.duration = 5;
	const seed = seedCanvasDocument({ ...emptyCanvas(), nodes: [node] });
	const a = new Y.Doc();
	const b = new Y.Doc();
	Y.applyUpdate(a, seed);
	Y.applyUpdate(b, seed);
	const first = createCanvasDocumentModel(a);
	const second = createCanvasDocumentModel(b);
	const before = first.read().document;
	first.apply(before, {
		...before,
		nodes: before.nodes.map((n) => ({
			...n,
			data: {
				...n.data,
				duration: 10,
				aspectRatio: "9:16",
				videoModel: "model-b",
			},
		})),
	});
	second.editText(node.id, "content", (text) => text.insert(0, "Hello"));
	merge(a, b);
	expect(second.read().document.nodes[0]?.data).toMatchObject({
		duration: 10,
		aspectRatio: "9:16",
		videoModel: "model-b",
		content: "Hello",
	});
	const restored = new Y.Doc();
	Y.applyUpdate(restored, seedCanvasDocument(second.read().document));
	expect(readCanvasDocument(restored).document).toEqual(first.read().document);
	first.destroy();
	second.destroy();
	a.destroy();
	b.destroy();
	restored.destroy();
});

it("syncs clip settings and project media selection while preserving a concurrent prompt", () => {
	const node = createCanvasNode("video", { x: 0, y: 0 });
	const seed = seedCanvasDocument({ ...emptyCanvas(), nodes: [node] });
	const a = new Y.Doc();
	const b = new Y.Doc();
	Y.applyUpdate(a, seed);
	Y.applyUpdate(b, seed);
	const first = createCanvasDocumentModel(a);
	const second = createCanvasDocumentModel(b);
	const before = first.read().document;
	const settings = {
		narrationStartMs: 1500,
		narrationVolume: 0.5,
		videoVolume: 1,
	};
	const assetId = crypto.randomUUID();
	first.apply(before, {
		...before,
		nodes: before.nodes.map((n) => ({
			...n,
			data: {
				...n.data,
				mediaSource: "project",
				assetId,
				clipSettings: settings,
			},
		})),
	});
	second.editText(node.id, "content", (text) =>
		text.insert(0, "Concurrent edit"),
	);
	merge(a, b);
	expect(second.read().document.nodes[0]?.data).toMatchObject({
		mediaSource: "project",
		assetId,
		clipSettings: settings,
		content: "Concurrent edit",
	});
	const restored = new Y.Doc();
	Y.applyUpdate(restored, seedCanvasDocument(second.read().document));
	expect(readCanvasDocument(restored).document).toEqual(first.read().document);
	first.history.undo();
	merge(a, b);
	expect(second.read().document.nodes[0]?.data.content).toBe("Concurrent edit");
	expect(second.read().document.nodes[0]?.data.clipSettings).toBeUndefined();
	first.destroy();
	second.destroy();
	a.destroy();
	b.destroy();
	restored.destroy();
});

it("shares historical selections, preserves concurrent prompts, and supports undo and portable recovery", () => {
	const { a, b, text, first, second } = fixture();
	const selectedRunId = crypto.randomUUID();
	const before = first.read().document;
	first.apply(before, {
		...before,
		nodes: before.nodes.map((node) =>
			node.id === text.id
				? { ...node, data: { ...node.data, selectedRunId } }
				: node,
		),
	});
	second.editText(text.id, "content", (value) => value.insert(0, "New "));
	merge(a, b);
	expect(
		second.read().document.nodes.find((node) => node.id === text.id)?.data,
	).toMatchObject({ selectedRunId, content: "New Hello world" });
	const restored = new Y.Doc();
	Y.applyUpdate(restored, seedCanvasDocument(first.read().document));
	expect(
		readCanvasDocument(restored).document.nodes.find(
			(node) => node.id === text.id,
		)?.data.selectedRunId,
	).toBe(selectedRunId);
	first.history.undo();
	merge(a, b);
	expect(
		second.read().document.nodes.find((node) => node.id === text.id)?.data
			.selectedRunId,
	).toBeUndefined();
	expect(
		second.read().document.nodes.find((node) => node.id === text.id)?.data
			.content,
	).toBe("New Hello world");
	restored.destroy();
});
