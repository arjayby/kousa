import { expect, it } from "vitest";
import {
	type CanvasDocument,
	canvasDocumentSchema,
	createCanvasNode,
} from "../src/canvas";
import { copyTemplateDocument } from "../src/template-document";

it("copies all authoring settings with fresh IDs and excludes assets and runtime fields", () => {
	const nodes = [
		createCanvasNode("text", { x: 10, y: -20 }),
		createCanvasNode("image", { x: 400, y: 0 }),
		createCanvasNode("video", { x: 800, y: 0 }),
		createCanvasNode("audio", { x: 400, y: 400 }),
	];
	for (const node of nodes)
		Object.assign(node.data, {
			content: "A coffee campaign",
			textModel: "text-model",
			imageModel: "image-model",
			videoModel: "video-model",
			speechModel: "speech-model",
			voiceId: "voice",
			voiceDirection: "Warm",
			assetId: crypto.randomUUID(),
			imageSource: "project",
			mediaSource: "project",
			clipSettings: {
				narrationStartMs: 500,
				narrationVolume: 0.8,
				videoVolume: 0.2,
			},
			output: "DO NOT COPY",
			runId: crypto.randomUUID(),
			selectedRunId: crypto.randomUUID(),
		});
	const connect = (source: number, target: number, targetHandle: string) => ({
		id: crypto.randomUUID(),
		source: nodes[source]?.id ?? "",
		target: nodes[target]?.id ?? "",
		sourceHandle: "output" as const,
		targetHandle,
	});
	const input = {
		version: 1 as const,
		nodes,
		edges: [
			connect(0, 1, "prompt"),
			connect(1, 2, "image"),
			connect(0, 3, "script"),
			connect(3, 2, "audio"),
		],
	};
	const original = JSON.stringify(input);
	const template = copyTemplateDocument(input);
	const project = copyTemplateDocument(template);
	expect(JSON.stringify(input)).toBe(original);
	for (const copy of [template, project]) {
		expect(canvasDocumentSchema.safeParse(copy).success).toBe(true);
		for (const [index, node] of copy.nodes.entries()) {
			expect(node.id).not.toBe(nodes[index]?.id);
			expect(node.position).toEqual(nodes[index]?.position);
			expect(node.data).toMatchObject({
				content: "A coffee campaign",
				voiceId: "voice",
				voiceDirection: "Warm",
				clipSettings: {
					narrationStartMs: 500,
					narrationVolume: 0.8,
					videoVolume: 0.2,
				},
			});
			expect(node.data.assetId).toBeUndefined();
			expect("output" in node.data).toBe(false);
			expect("runId" in node.data).toBe(false);
			expect(node.data.selectedRunId).toBeUndefined();
		}
		expect(copy.nodes[1]?.data.imageSource).toBe("generated");
		expect(copy.nodes[2]?.data.mediaSource).toBe("generated");
		expect(copy.nodes[3]?.data.mediaSource).toBe("generated");
		expect(copy.edges[3]).toMatchObject({
			source: copy.nodes[3]?.id,
			target: copy.nodes[2]?.id,
			targetHandle: "audio",
		});
	}
	expect(
		project.nodes
			.map((n) => n.id)
			.some((id) => template.nodes.some((n) => n.id === id)),
	).toBe(false);
	expect(
		project.edges
			.map((e) => e.id)
			.some((id) => template.edges.some((e) => e.id === id)),
	).toBe(false);
});
it("rejects malformed, unsupported and cyclic documents", () => {
	const a = createCanvasNode("text", { x: 0, y: 0 });
	const b = createCanvasNode("text", { x: 0, y: 0 });
	const document: CanvasDocument = {
		version: 1,
		nodes: [a, b],
		edges: [
			{
				id: crypto.randomUUID(),
				source: a.id,
				target: b.id,
				sourceHandle: "output",
				targetHandle: "context",
			},
		],
	};
	expect(() => copyTemplateDocument({ ...document, version: 2 })).toThrow();
	expect(() => copyTemplateDocument({ ...document, nodes: [a, a] })).toThrow();
	expect(() => copyTemplateDocument({ ...document, nodes: [a] })).toThrow();
	expect(() =>
		copyTemplateDocument({
			...document,
			edges: [
				...document.edges,
				{
					id: crypto.randomUUID(),
					source: b.id,
					target: a.id,
					sourceHandle: "output",
					targetHandle: "context",
				},
			],
		}),
	).toThrow();
});
