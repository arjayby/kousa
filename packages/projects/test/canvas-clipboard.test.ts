import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	type CanvasDocument,
	type CanvasNode,
	canvasDocumentSchema,
	createCanvasNode,
	emptyCanvas,
} from "../src/canvas";
import {
	copyCanvasSelection,
	parseCanvasClipboard,
	pasteCanvasSelection,
} from "../src/canvas-clipboard";
import {
	createCanvasDocumentModel,
	seedCanvasDocument,
} from "../src/canvas-document";

const projectId = crypto.randomUUID();
const edge = (
	source: CanvasNode,
	target: CanvasNode,
	targetHandle: string,
) => ({
	id: crypto.randomUUID(),
	source: source.id,
	target: target.id,
	sourceHandle: "output" as const,
	targetHandle,
});
function fixture() {
	const brief = createCanvasNode("text", { x: -100, y: 100 });
	const prompt = createCanvasNode("text", { x: 280, y: -80 });
	const image = createCanvasNode("image", { x: 660, y: -80 });
	const video = createCanvasNode("video", { x: 1040, y: 200 });
	const speech = createCanvasNode("audio", { x: 660, y: 340 });
	const document: CanvasDocument = {
		version: 1,
		nodes: [brief, prompt, image, video, speech],
		edges: [
			edge(brief, prompt, "context"),
			edge(prompt, image, "prompt"),
			edge(image, video, "image"),
			edge(prompt, speech, "script"),
			edge(speech, video, "audio"),
		],
	};
	return { document, brief, prompt, image, video, speech };
}

describe("canvas selection copying", () => {
	it("copies internal connections without either incoming or outgoing external links", () => {
		const { document, prompt, image } = fixture();
		const original = JSON.stringify(document);
		const clipboard = copyCanvasSelection(
			document,
			[prompt.id, image.id],
			projectId,
		);
		const decoded = parseCanvasClipboard(JSON.stringify(clipboard));
		expect(decoded).toEqual(clipboard);
		const first = pasteCanvasSelection(clipboard, document, projectId);
		const second = pasteCanvasSelection(clipboard, document, projectId);
		expect(first.nodes).toHaveLength(2);
		expect(first.edges).toHaveLength(1);
		expect(first.edges[0]).toMatchObject({
			source: first.nodes[0]?.id,
			target: first.nodes[1]?.id,
			targetHandle: "prompt",
		});
		const allIds = [
			...document.nodes,
			...document.edges,
			...first.nodes,
			...first.edges,
			...second.nodes,
			...second.edges,
		].map((item) => item.id);
		expect(new Set(allIds).size).toBe(allIds.length);
		expect(first.nodes[0]?.position).toEqual({ x: 328, y: -32 });
		expect(first.nodes[1]?.position).toEqual({ x: 708, y: -32 });
		expect(JSON.stringify(document)).toBe(original);
	});
	it("preserves authoring settings for every kind, retaining only explicit same-project media", () => {
		const { document, image, video, speech } = fixture();
		for (const node of document.nodes)
			Object.assign(node.data, {
				content: "A new scene",
				aspectRatio: "9:16",
				duration: 10,
				textModel: "text-model",
				imageModel: "image-model",
				videoModel: "video-model",
				speechModel: "speech-model",
				voiceId: "voice",
				voiceDirection: "Calm",
				selectedRunId: crypto.randomUUID(),
				clipSettings: {
					narrationStartMs: 250,
					narrationVolume: 0.7,
					videoVolume: 0.2,
				},
				output: "private result",
				runtimeStatus: "running",
			});
		image.data.assetId = crypto.randomUUID();
		image.data.imageSource = "project";
		video.data.assetId = crypto.randomUUID();
		video.data.mediaSource = "generated";
		speech.data.assetId = crypto.randomUUID();
		speech.data.mediaSource = "project";
		const clipboard = copyCanvasSelection(
			document,
			document.nodes.map((node) => node.id),
			projectId,
		);
		const copy = pasteCanvasSelection(clipboard, document, projectId);
		for (const node of copy.nodes) {
			expect(node.data).toMatchObject({
				content: "A new scene",
				aspectRatio: "9:16",
				duration: 10,
				textModel: "text-model",
				imageModel: "image-model",
				videoModel: "video-model",
				speechModel: "speech-model",
				voiceId: "voice",
				voiceDirection: "Calm",
				clipSettings: {
					narrationStartMs: 250,
					narrationVolume: 0.7,
					videoVolume: 0.2,
				},
			});
			expect(node.data.selectedRunId).toBeUndefined();
			expect(node.data).not.toHaveProperty("output");
			expect(node.data).not.toHaveProperty("runtimeStatus");
		}
		expect(copy.nodes[2]?.data).toMatchObject({
			assetId: image.data.assetId,
			imageSource: "project",
		});
		expect(copy.nodes[3]?.data.assetId).toBeUndefined();
		expect(copy.nodes[4]?.data).toMatchObject({
			assetId: speech.data.assetId,
			mediaSource: "project",
		});
	});
	it("clears private media and result selections across projects without losing authored prompts", () => {
		const { document } = fixture();
		for (const node of document.nodes)
			Object.assign(node.data, {
				assetId: crypto.randomUUID(),
				selectedRunId: crypto.randomUUID(),
				imageSource: "project",
				mediaSource: "project",
				content: "Keep this prompt",
			});
		const clipboard = copyCanvasSelection(
			document,
			document.nodes.map((node) => node.id),
			projectId,
		);
		const copy = pasteCanvasSelection(
			clipboard,
			emptyCanvas(),
			crypto.randomUUID(),
		);
		for (const node of copy.nodes) {
			expect(node.data.assetId).toBeUndefined();
			expect(node.data.selectedRunId).toBeUndefined();
			expect(node.data.content).toBe("Keep this prompt");
			if (node.type === "image")
				expect(node.data.imageSource).toBe("generated");
			if (node.type === "video" || node.type === "audio")
				expect(node.data.mediaSource).toBe("generated");
		}
		expect(copy.edges).toHaveLength(document.edges.length);
	});
	it("keeps relative positions at coordinate boundaries and respects label length limits", () => {
		const { document, prompt, image } = fixture();
		prompt.data.label = "x".repeat(80);
		const clipboard = copyCanvasSelection(
			document,
			[prompt.id, image.id],
			projectId,
		);
		for (const anchor of [
			{ x: 100_000, y: 100_000 },
			{ x: -150_000, y: -150_000 },
		]) {
			const copy = pasteCanvasSelection(clipboard, document, projectId, anchor);
			expect(canvasDocumentSchema.safeParse(copy).success).toBe(true);
			expect(
				(copy.nodes[1]?.position.x ?? 0) - (copy.nodes[0]?.position.x ?? 0),
			).toBe(380);
			expect(copy.nodes[0]?.data.label).toHaveLength(80);
		}
	});
	it("rejects malformed, oversized, unsupported, empty, and disconnected clipboard documents", () => {
		const { document, prompt, image } = fixture();
		const clipboard = copyCanvasSelection(
			document,
			[prompt.id, image.id],
			projectId,
		);
		for (const value of [
			"plain text",
			"{}",
			"x".repeat(25_000_001),
			JSON.stringify({ ...clipboard, version: 2 }),
			JSON.stringify({ ...clipboard, document: emptyCanvas() }),
			JSON.stringify({
				...clipboard,
				document: { ...clipboard.document, nodes: [prompt] },
			}),
			JSON.stringify({
				...clipboard,
				document: { ...clipboard.document, nodes: [prompt, prompt] },
			}),
		])
			expect(parseCanvasClipboard(value)).toBeNull();
		expect(() => copyCanvasSelection(document, [], projectId)).toThrow();
	});
	it("rejects cycles and incompatible ports before inserting anything", () => {
		const { document, brief, prompt } = fixture();
		const clipboard = copyCanvasSelection(
			document,
			[brief.id, prompt.id],
			projectId,
		);
		clipboard.document.edges.push(edge(prompt, brief, "context"));
		expect(parseCanvasClipboard(JSON.stringify(clipboard))).toBeNull();
		clipboard.document.edges = [edge(brief, prompt, "prompt")];
		expect(parseCanvasClipboard(JSON.stringify(clipboard))).toBeNull();
	});
	it("rejects the whole insertion when it would exceed node or edge capacity", () => {
		const { document, prompt, image } = fixture();
		const clipboard = copyCanvasSelection(
			document,
			[prompt.id, image.id],
			projectId,
		);
		const full = {
			...emptyCanvas(),
			nodes: Array.from({ length: 199 }, () =>
				createCanvasNode("text", { x: 0, y: 0 }),
			),
		};
		expect(() => pasteCanvasSelection(clipboard, full, projectId)).toThrow(
			"200-node",
		);
		expect(full.nodes).toHaveLength(199);
		const sources = [
			createCanvasNode("text", { x: 0, y: 0 }),
			createCanvasNode("image", { x: 0, y: 0 }),
			createCanvasNode("audio", { x: 0, y: 0 }),
			createCanvasNode("video", { x: 0, y: 0 }),
		];
		const targets = Array.from({ length: 150 }, () =>
			createCanvasNode("video", { x: 0, y: 0 }),
		);
		const ports = ["prompt", "image", "audio", "video"];
		const connected: CanvasDocument = {
			version: 1,
			nodes: [...sources, ...targets],
			edges: targets.flatMap((target) =>
				sources.map((source, i) => edge(source, target, ports[i] ?? "")),
			),
		};
		expect(canvasDocumentSchema.safeParse(connected).success).toBe(true);
		expect(() => pasteCanvasSelection(clipboard, connected, projectId)).toThrow(
			"600-connection",
		);
		expect(connected.edges).toHaveLength(600);
	});
	it("shares an insertion and undoes/redoes it as one edit while preserving a collaborator's edit", () => {
		const { document, prompt, image, brief } = fixture();
		const clipboard = copyCanvasSelection(
			document,
			[prompt.id, image.id],
			projectId,
		);
		const first = createCanvasDocumentModel(new Y.Doc());
		const second = createCanvasDocumentModel(new Y.Doc());
		Y.applyUpdate(first.doc, seedCanvasDocument(document));
		Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));
		const copy = pasteCanvasSelection(clipboard, document, projectId);
		first.apply(document, {
			version: 1,
			nodes: [...document.nodes, ...copy.nodes],
			edges: [...document.edges, ...copy.edges],
		});
		second.editText(brief.id, "content", (text) =>
			text.insert(0, "Collaborator edit"),
		);
		const merge = () => {
			Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc));
			Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));
		};
		merge();
		expect(second.read().document.nodes).toHaveLength(7);
		first.history.undo();
		merge();
		expect(second.read().document.nodes).toHaveLength(5);
		expect(second.read().document.edges).toHaveLength(5);
		expect(
			second.read().document.nodes.find((node) => node.id === brief.id)?.data
				.content,
		).toBe("Collaborator edit");
		expect(first.history.canUndo()).toBe(false);
		first.history.redo();
		merge();
		expect(second.read().document.nodes).toHaveLength(7);
		expect(second.read().document.edges).toHaveLength(6);
		expect(second.read().rejected).toBe(0);
		first.destroy();
		second.destroy();
		first.doc.destroy();
		second.doc.destroy();
	});
});
