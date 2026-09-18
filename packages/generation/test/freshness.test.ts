import {
	type CanvasDocument,
	type CanvasNode,
	createCanvasNode,
} from "@kousa/projects/canvas";
import { expect, it } from "vitest";
import { graphFreshness, inputSnapshot, resolveInputs } from "../src/freshness";

it.each<[CanvasNode["type"], Partial<CanvasNode["data"]>]>([
	["text", { content: "New prompt" }],
	["text", { textModel: "amazon/nova-lite" }],
	["image", { aspectRatio: "16:9" }],
	["speech", { voiceId: "another-voice" }],
	["speech", { voiceDirection: "Quietly" }],
	["video", { duration: 10 }],
	["video", { aspectRatio: "9:16" }],
])(
	"marks %s outdated when its generation settings change: %j",
	(kind, patch) => {
		const node = createCanvasNode(kind, { x: 0, y: 0 });
		node.data.content = "Original prompt";
		const graph: CanvasDocument = { version: 1, nodes: [node], edges: [] };
		const run = {
			id: crypto.randomUUID(),
			nodeId: node.id,
			kind,
			output: kind === "text" ? "Result" : null,
			assetId: kind === "text" ? null : crypto.randomUUID(),
			resolvedInputs: resolveInputs(inputSnapshot(graph, node.id), []),
		};
		expect(graphFreshness(graph, [run]).get(node.id)?.state).toBe("current");
		Object.assign(node.data, patch);
		expect(graphFreshness(graph, [run]).get(node.id)?.state).toBe("outdated");
	},
);

it("detects a changed connection even when both sources have identical text", () => {
	const a = createCanvasNode("text", { x: 0, y: 0 });
	const b = createCanvasNode("text", { x: 0, y: 0 });
	const target = createCanvasNode("image", { x: 0, y: 0 });
	const graph: CanvasDocument = {
		version: 1,
		nodes: [a, b, target],
		edges: [
			{
				id: crypto.randomUUID(),
				source: a.id,
				target: target.id,
				sourceHandle: "output",
				targetHandle: "prompt",
			},
		],
	};
	const sources = [a, b].map((node) => ({
		id: crypto.randomUUID(),
		nodeId: node.id,
		kind: "text",
		output: "Same",
		assetId: null,
		resolvedInputs: resolveInputs(inputSnapshot(graph, node.id), []),
	}));
	const result = {
		id: crypto.randomUUID(),
		nodeId: target.id,
		kind: "image",
		output: null,
		assetId: crypto.randomUUID(),
		resolvedInputs: resolveInputs(inputSnapshot(graph, target.id), sources),
	};
	expect(
		graphFreshness(graph, [...sources, result]).get(target.id)?.state,
	).toBe("current");
	const edge = graph.edges[0];
	if (!edge) throw new Error("Missing edge");
	edge.source = b.id;
	expect(
		graphFreshness(graph, [...sources, result]).get(target.id)?.reason,
	).toBe("Connections changed.");
});

it("ignores source edits behind a project image and detects a replaced asset", () => {
	const image = createCanvasNode("image", { x: 0, y: 0 });
	image.data.imageSource = "project";
	image.data.assetId = crypto.randomUUID();
	const video = createCanvasNode("video", { x: 0, y: 0 });
	const graph: CanvasDocument = {
		version: 1,
		nodes: [image, video],
		edges: [
			{
				id: crypto.randomUUID(),
				source: image.id,
				target: video.id,
				sourceHandle: "output",
				targetHandle: "image",
			},
		],
	};
	const run = {
		id: crypto.randomUUID(),
		nodeId: video.id,
		kind: "video",
		output: null,
		assetId: crypto.randomUUID(),
		resolvedInputs: resolveInputs(inputSnapshot(graph, video.id), []),
	};
	image.data.content = "A new prompt that does not change the uploaded image";
	expect(graphFreshness(graph, [run]).get(video.id)?.state).toBe("current");
	image.data.assetId = crypto.randomUUID();
	expect(graphFreshness(graph, [run]).get(video.id)?.state).toBe("outdated");
});
