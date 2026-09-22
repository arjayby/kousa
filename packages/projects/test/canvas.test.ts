import { describe, expect, it } from "vitest";
import {
	type CanvasEdge,
	canvasDocumentSchema,
	canvasDraftKey,
	connectionError,
	createCanvasNode,
	emptyCanvas,
	imageOutputAssetId,
	inputPorts,
	type NodeKind,
	nodeKinds,
	removeCanvasElements,
} from "../src/canvas";

const node = (type: NodeKind) => createCanvasNode(type, { x: 0, y: 0 });
const edge = (
	source: string,
	target: string,
	targetHandle: string,
): CanvasEdge => ({
	id: crypto.randomUUID(),
	source,
	target,
	sourceHandle: "output",
	targetHandle,
});

describe("canvas graph rules", () => {
	it("loads legacy speech nodes as audio without changing settings or connections", () => {
		const script = node("text");
		const audio = node("audio");
		audio.data = {
			...audio.data,
			label: "Custom narration",
			content: "Keep my script",
			voiceDirection: "Calm",
			voiceId: "saved-voice",
			speechModel: "saved-model",
			assetId: crypto.randomUUID(),
			selectedRunId: crypto.randomUUID(),
		};
		const video = node("video");
		const graph = {
			...emptyCanvas(),
			nodes: [script, audio, video],
			edges: [
				edge(script.id, audio.id, "script"),
				edge(audio.id, video.id, "audio"),
			],
		};
		expect(
			canvasDocumentSchema.parse({
				...graph,
				nodes: [script, { ...audio, type: "speech" }, video],
			}),
		).toEqual(graph);
	});
	it("does not replace a missing historical image with an old attachment", () => {
		const data = {
			imageSource: "generated" as const,
			assetId: crypto.randomUUID(),
			selectedRunId: crypto.randomUUID(),
		};
		expect(imageOutputAssetId(data, null)).toBeNull();
		const historicalAssetId = crypto.randomUUID();
		expect(imageOutputAssetId(data, historicalAssetId)).toBe(historicalAssetId);
		expect(imageOutputAssetId({ ...data, imageSource: "project" }, null)).toBe(
			data.assetId,
		);
	});
	it("allows each advertised input type and rejects every incompatible type", () => {
		for (const targetType of nodeKinds)
			for (const port of inputPorts[targetType])
				for (const sourceType of nodeKinds) {
					const source = node(sourceType);
					const target = node(targetType);
					const message = connectionError(
						{ nodes: [source, target], edges: [] },
						edge(source.id, target.id, port.id),
					);
					expect(message === null).toBe(port.accepts.includes(sourceType));
				}
	});
	it("rejects self links, dangling references, and unknown handles", () => {
		const a = node("text");
		const b = node("image");
		const graph = { nodes: [a, b], edges: [] };
		expect(connectionError(graph, edge(a.id, a.id, "context"))).toBeTruthy();
		expect(
			connectionError(graph, edge(a.id, crypto.randomUUID(), "prompt")),
		).toBeTruthy();
		expect(connectionError(graph, edge(a.id, b.id, "missing"))).toBeTruthy();
	});
	it("allows fan-out but prevents multiple links to one input", () => {
		const a = node("text");
		const b = node("image");
		const c = node("audio");
		const first = edge(a.id, b.id, "prompt");
		const graph = { nodes: [a, b, c], edges: [first] };
		expect(connectionError(graph, edge(a.id, c.id, "script"))).toBeNull();
		expect(connectionError(graph, edge(a.id, b.id, "prompt"))).toBeTruthy();
		expect(connectionError(graph, first, first.id)).toBeNull();
	});
	it("prevents multi-hop cycles", () => {
		const a = node("text");
		const b = node("text");
		const c = node("text");
		const graph = {
			nodes: [a, b, c],
			edges: [edge(a.id, b.id, "context"), edge(b.id, c.id, "context")],
		};
		expect(connectionError(graph, edge(c.id, a.id, "context"))).toContain(
			"loop",
		);
	});
	it("deleting a node removes only its attached edges", () => {
		const a = node("text");
		const b = node("image");
		const c = node("audio");
		const toB = edge(a.id, b.id, "prompt");
		const toC = edge(a.id, c.id, "script");
		const graph = { ...emptyCanvas(), nodes: [a, b, c], edges: [toB, toC] };
		expect(removeCanvasElements(graph, [b.id], [])).toEqual({
			...graph,
			nodes: [a, c],
			edges: [toC],
		});
		expect(removeCanvasElements(graph, [], [toB.id]).nodes).toEqual(
			graph.nodes,
		);
	});
	it("validates drafts and strips transient UI state", () => {
		const a = node("text");
		const b = node("image");
		const graph = {
			...emptyCanvas(),
			nodes: [{ ...a, selected: true }, b],
			edges: [edge(a.id, b.id, "prompt")],
		};
		expect(canvasDocumentSchema.parse(graph).nodes[0]).not.toHaveProperty(
			"selected",
		);
		expect(
			canvasDocumentSchema.safeParse({ ...graph, version: 2 }).success,
		).toBe(false);
		expect(
			canvasDocumentSchema.safeParse({ ...graph, nodes: [a, a] }).success,
		).toBe(false);
		expect(
			canvasDocumentSchema.safeParse({ ...graph, nodes: [a] }).success,
		).toBe(false);
		expect(
			canvasDocumentSchema.safeParse({
				...graph,
				nodes: [{ ...a, position: { x: Number.POSITIVE_INFINITY, y: 0 } }, b],
			}).success,
		).toBe(false);
	});
	it("keeps local drafts separate between users and projects", () => {
		expect(canvasDraftKey("user-a", "project-a")).not.toBe(
			canvasDraftKey("user-b", "project-a"),
		);
		expect(canvasDraftKey("user-a", "project-a")).not.toBe(
			canvasDraftKey("user-a", "project-b"),
		);
	});
});
