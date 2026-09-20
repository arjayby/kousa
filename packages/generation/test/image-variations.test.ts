import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createImageLayout } from "@kousa/projects/image-layout";
import { describe, expect, it } from "vitest";
import { planGraph } from "../src/graph-plan";
import {
	createImageVariations,
	type ImageVariationsRequest,
	imageVariationSourceKey,
} from "../src/image-variations";

function fixture() {
	const prompt = createCanvasNode("text", { x: 0, y: 0 });
	prompt.data.content = "Describe a product ad";
	const reference = createCanvasNode("image", { x: 0, y: 450 });
	reference.data.assetId = crypto.randomUUID();
	reference.data.imageSource = "project";
	const source = createCanvasNode("image", { x: 400, y: 0 });
	source.data.content = "Keep the label readable";
	source.data.label = "Product ad";
	source.data.selectedRunId = crypto.randomUUID();
	source.data.assetId = crypto.randomUUID();
	source.data.imageLayout = createImageLayout(source.data.assetId);
	const output = createCanvasNode("video", { x: 800, y: 0 });
	const edge = (a: string, b: string, port: string) => ({
		id: crypto.randomUUID(),
		source: a,
		target: b,
		sourceHandle: "output" as const,
		targetHandle: port,
	});
	const graph: CanvasDocument = {
		version: 1,
		nodes: [prompt, reference, source, output],
		edges: [
			edge(prompt.id, source.id, "prompt"),
			edge(reference.id, source.id, "reference"),
			edge(source.id, output.id, "image"),
		],
	};
	const request: ImageVariationsRequest = {
		sourceId: source.id,
		mode: "inputs",
		referenceAssetId: source.data.assetId,
		prompt: source.data.content,
		variations: [
			{ instructions: "Warm light", aspectRatio: "1:1" },
			{ instructions: "Dark background", aspectRatio: "9:16" },
		],
	};
	return { graph, source, prompt, reference, output, request };
}
const merge = (
	graph: CanvasDocument,
	addition: ReturnType<typeof createImageVariations>,
): CanvasDocument => ({
	version: 1,
	nodes: [...graph.nodes, ...addition.nodes],
	edges: [...graph.edges, ...addition.edges],
});

describe("image variations", () => {
	it("shares incoming inputs while leaving the original, its outputs and downstream links unchanged", async () => {
		const { graph, request, source, prompt, reference, output } = fixture();
		const before = structuredClone(graph);
		const added = createImageVariations(graph, request);
		expect(graph).toEqual(before);
		expect(added.nodes).toHaveLength(2);
		expect(added.edges).toHaveLength(4);
		for (const node of added.nodes) {
			expect(node.data.imageSource).toBe("generated");
			expect(node.data.assetId).toBeUndefined();
			expect(node.data.selectedRunId).toBeUndefined();
			expect(node.data.imageLayout).toBeUndefined();
			expect(
				added.edges
					.filter((edge) => edge.target === node.id)
					.map((edge) => edge.source)
					.sort(),
			).toEqual([prompt.id, reference.id].sort());
		}
		expect(added.nodes.map((node) => node.data.content)).toEqual([
			"Keep the label readable\n\nWarm light",
			"Keep the label readable\n\nDark background",
		]);
		expect(added.nodes.map((node) => node.data.aspectRatio)).toEqual([
			"1:1",
			"9:16",
		]);
		const plan = await planGraph(merge(graph, added), added.targetIds);
		expect(plan.plan.map((step) => step.nodeId)).not.toContain(source.id);
		expect(plan.plan.map((step) => step.nodeId)).not.toContain(output.id);
		expect(plan.plan.filter((step) => step.nodeId === prompt.id)).toHaveLength(
			1,
		);
		expect(plan.plan.reduce((total, step) => total + step.credits, 0)).toBe(7);
	});
	it("pins the displayed image once and excludes its generation ancestors", async () => {
		const { graph, request, source } = fixture();
		const added = createImageVariations(graph, { ...request, mode: "image" });
		expect(added.nodes).toHaveLength(3);
		const reference = added.nodes.find(
			(node) => !added.targetIds.includes(node.id),
		);
		expect(reference?.data).toMatchObject({
			assetId: request.referenceAssetId,
			imageSource: "project",
			content: "",
		});
		expect(
			added.edges.every(
				(edge) =>
					edge.source === reference?.id && edge.targetHandle === "reference",
			),
		).toBe(true);
		source.data.assetId = crypto.randomUUID();
		const plan = await planGraph(merge(graph, added), added.targetIds);
		expect(plan.plan).toHaveLength(2);
		expect(
			plan.plan.every(
				(step) =>
					step.kind === "image" &&
					step.image?.assetId === request.referenceAssetId,
			),
		).toBe(true);
		expect(plan.plan.reduce((total, step) => total + step.credits, 0)).toBe(6);
	});
	it("keeps identical prompts as separate output nodes with unique IDs", () => {
		const { graph, request } = fixture();
		request.variations = Array.from({ length: 8 }, () => ({
			instructions: "",
			aspectRatio: "1:1",
		}));
		const a = createImageVariations(graph, request);
		const b = createImageVariations(merge(graph, a), request);
		const ids = [...a.nodes, ...b.nodes, ...a.edges, ...b.edges].map(
			(item) => item.id,
		);
		expect(new Set(ids).size).toBe(ids.length);
		expect(a.targetIds).toHaveLength(8);
	});
	it("keeps placement within canvas bounds and avoids existing nodes", () => {
		const { graph, request, source } = fixture();
		for (const coordinate of [-100_000, 0, 100_000]) {
			source.position = { x: coordinate, y: coordinate };
			const added = createImageVariations(graph, { ...request, mode: "image" });
			const all = [...graph.nodes, ...added.nodes];
			for (const node of added.nodes) {
				expect(Math.abs(node.position.x)).toBeLessThanOrEqual(100_000);
				expect(Math.abs(node.position.y)).toBeLessThanOrEqual(100_000);
				expect(
					all.some(
						(other) =>
							other.id !== node.id &&
							Math.abs(other.position.x - node.position.x) < 350 &&
							Math.abs(other.position.y - node.position.y) < 420,
					),
				).toBe(false);
			}
		}
	});
	it("refuses invalid counts, empty prompts, missing sources or references, unavailable models and oversized Unicode prompts", () => {
		const { graph, request, source } = fixture();
		for (const count of [0, 1, 9])
			expect(() =>
				createImageVariations(graph, {
					...request,
					variations: Array.from(
						{ length: count },
						() =>
							request
								.variations[0] as ImageVariationsRequest["variations"][number],
					),
				}),
			).toThrow();
		expect(() =>
			createImageVariations(graph, {
				...request,
				mode: "image",
				referenceAssetId: null,
			}),
		).toThrow("reference");
		expect(() =>
			createImageVariations(graph, {
				...request,
				sourceId: crypto.randomUUID(),
			}),
		).toThrow("still on");
		expect(() =>
			createImageVariations(graph, { ...request, prompt: "😀".repeat(4000) }),
		).toThrow("too long");
		expect(() =>
			createImageVariations(graph, {
				...request,
				mode: "image",
				prompt: "",
				variations: request.variations.map((item) => ({
					...item,
					instructions: "",
				})),
			}),
		).toThrow("common prompt");
		source.data.imageModel = "unknown";
		expect(() => createImageVariations(graph, request)).toThrow(
			"available image model",
		);
	});
	it("rejects capacity overflow before modifying the graph and the planner checks the combined ancestor limit", async () => {
		const { graph, request, prompt } = fixture();
		const full = {
			...graph,
			nodes: [
				...graph.nodes,
				...Array.from({ length: 195 }, () =>
					createCanvasNode("text", { x: 0, y: 0 }),
				),
			],
		};
		expect(() => createImageVariations(full, request)).toThrow("200-node");
		expect(full.nodes).toHaveLength(199);
		expect(() =>
			createImageVariations(
				{ ...graph, edges: Array(599).fill(graph.edges[0]) },
				request,
			),
		).toThrow("600-connection");
		let target = prompt.id;
		for (let i = 0; i < 18; i++) {
			const input = createCanvasNode("text", { x: -400 * (i + 1), y: 0 });
			input.data.content = "Context";
			graph.nodes.push(input);
			graph.edges.push({
				id: crypto.randomUUID(),
				source: input.id,
				target,
				sourceHandle: "output",
				targetHandle: "context",
			});
			target = input.id;
		}
		const added = createImageVariations(graph, request);
		await expect(
			planGraph(merge(graph, added), added.targetIds),
		).rejects.toThrow("20 connected");
	});
	it("detects changed settings, reference selections and connections without blocking unrelated moves", () => {
		const { graph, request, source, reference, output } = fixture();
		const key = imageVariationSourceKey(graph, request.sourceId);
		output.data.content = "Unrelated";
		source.position.x += 10;
		expect(imageVariationSourceKey(graph, request.sourceId)).toBe(key);
		reference.data.assetId = crypto.randomUUID();
		expect(imageVariationSourceKey(graph, request.sourceId)).not.toBe(key);
		const next = imageVariationSourceKey(graph, request.sourceId);
		graph.edges = graph.edges.filter((edge) => edge.source !== reference.id);
		expect(imageVariationSourceKey(graph, request.sourceId)).not.toBe(next);
	});
});
