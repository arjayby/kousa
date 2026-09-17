import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { expect, it } from "vitest";
import { graphOutputIds, planGraph } from "../src/graph-plan";
import { selectGraphOutputs } from "../src/graph-selection";

const connect = (source: string, target: string, targetHandle = "context") => ({
	id: crypto.randomUUID(),
	source,
	target,
	targetHandle,
	sourceHandle: "output" as const,
});
function fixture() {
	const brief = createCanvasNode("text", { x: 0, y: 0 });
	brief.data.content = "Write a campaign brief.";
	const prompt = createCanvasNode("text", { x: 200, y: 0 });
	prompt.data.content = "Write a visual prompt.";
	const scene = createCanvasNode("image", { x: 400, y: 0 });
	const video = createCanvasNode("video", { x: 600, y: 0 });
	video.data.content = "Pan slowly.";
	const script = createCanvasNode("text", { x: 200, y: 300 });
	script.data.content = "Write a short narration.";
	const voice = createCanvasNode("speech", { x: 400, y: 300 });
	const graph: CanvasDocument = {
		version: 1,
		nodes: [brief, prompt, scene, video, script, voice],
		edges: [
			connect(brief.id, prompt.id),
			connect(prompt.id, scene.id, "prompt"),
			connect(scene.id, video.id, "image"),
			connect(brief.id, script.id),
			connect(script.id, voice.id, "script"),
		],
	};
	return { graph, brief, prompt, scene, video, script, voice };
}

it("replaces a selected ancestor with its descendant while keeping all generation steps and cost", async () => {
	const { graph, brief, prompt, scene } = fixture();
	const first = selectGraphOutputs(graph, [prompt.id]);
	expect(first.targets).toEqual([prompt.id]);
	expect(first.included).toEqual(new Set([brief.id]));
	const next = selectGraphOutputs(graph, [...first.targets, scene.id]);
	expect(next.targets).toEqual([scene.id]);
	expect(next.included).toEqual(new Set([brief.id, prompt.id]));
	expect(selectGraphOutputs(graph, [scene.id, prompt.id])).toEqual(next);
	const plan = await planGraph(graph, next.targets);
	expect(plan.plan.map((step) => step.nodeId)).toEqual([
		brief.id,
		prompt.id,
		scene.id,
	]);
	expect(plan.plan.reduce((cost, step) => cost + step.credits, 0)).toBe(5);
});
it("re-enables included inputs without reselecting them when their last output is unchecked", () => {
	const { graph, prompt, scene } = fixture();
	const chosen = selectGraphOutputs(graph, [prompt.id, scene.id]).targets;
	const removed = selectGraphOutputs(
		graph,
		chosen.filter((id) => id !== scene.id),
	);
	expect(removed.targets).toEqual([]);
	expect(removed.included.size).toBe(0);
	expect(selectGraphOutputs(graph, [prompt.id]).targets).toEqual([prompt.id]);
});
it("keeps independent branches selected and shared ancestors included until no branch needs them", async () => {
	const { graph, brief, prompt, scene, video, script, voice } = fixture();
	const picked = selectGraphOutputs(graph, [
		brief.id,
		prompt.id,
		scene.id,
		video.id,
		script.id,
		voice.id,
	]);
	expect(picked.targets).toEqual([video.id, voice.id]);
	expect(picked.included).toEqual(
		new Set([brief.id, prompt.id, scene.id, script.id]),
	);
	const remaining = selectGraphOutputs(
		graph,
		picked.targets.filter((id) => id !== video.id),
	);
	expect(remaining.targets).toEqual([voice.id]);
	expect(remaining.included).toEqual(new Set([brief.id, script.id]));
	const plan = await planGraph(graph, picked.targets);
	expect(plan.plan.reduce((cost, step) => cost + step.credits, 0)).toBe(18);
	expect(selectGraphOutputs(graph, graphOutputIds(graph))).toEqual(picked);
});
it("does not hide an unrelated output", () => {
	const { graph, scene, brief, prompt } = fixture();
	const extra = createCanvasNode("text", { x: 0, y: 600 });
	graph.nodes.push(extra);
	const picked = selectGraphOutputs(graph, [scene.id, extra.id]);
	expect(picked.targets).toEqual([scene.id, extra.id]);
	expect(picked.included).toEqual(new Set([brief.id, prompt.id]));
});
it("keeps fixed project images selectable because the video will not regenerate that branch", async () => {
	const { graph, brief, prompt, scene, video } = fixture();
	scene.data.imageSource = "project";
	scene.data.assetId = crypto.randomUUID();
	const picked = selectGraphOutputs(graph, [video.id]);
	expect(picked.included.size).toBe(0);
	expect(
		(await planGraph(graph, picked.targets)).plan.map((step) => step.nodeId),
	).toEqual([video.id]);
	const together = selectGraphOutputs(graph, [scene.id, video.id, prompt.id]);
	expect(together.targets).toEqual([scene.id, video.id]);
	expect(together.included).toEqual(new Set([brief.id, prompt.id]));
	scene.data.imageSource = "generated";
	expect(selectGraphOutputs(graph, together.targets).targets).toEqual([
		video.id,
	]);
	scene.data.imageSource = undefined;
	expect(selectGraphOutputs(graph, together.targets).targets).toEqual(
		together.targets,
	);
});
it("follows a separate prompt dependency even when the video uses a fixed image", () => {
	const { graph, brief, prompt, scene, video } = fixture();
	scene.data.imageSource = "project";
	scene.data.assetId = crypto.randomUUID();
	graph.edges.push(connect(prompt.id, video.id, "prompt"));
	const picked = selectGraphOutputs(graph, [video.id, prompt.id, scene.id]);
	expect(picked.targets).toEqual([video.id, scene.id]);
	expect(picked.included).toEqual(new Set([brief.id, prompt.id]));
});
it("recomputes against live canvas changes and removes missing or duplicate selected nodes", () => {
	const { graph, prompt, scene } = fixture();
	expect(selectGraphOutputs(graph, [scene.id]).included.has(prompt.id)).toBe(
		true,
	);
	graph.edges = graph.edges.filter((edge) => edge.target !== scene.id);
	expect(selectGraphOutputs(graph, [scene.id]).included.size).toBe(0);
	graph.nodes = graph.nodes.filter((node) => node.id !== scene.id);
	expect(
		selectGraphOutputs(graph, [scene.id, prompt.id, prompt.id, "missing"])
			.targets,
	).toEqual([prompt.id]);
});
it("does not hide all choices or loop when a live graph contains a cycle", async () => {
	const { graph, brief, prompt } = fixture();
	graph.edges.push(connect(prompt.id, brief.id));
	const picked = selectGraphOutputs(graph, [brief.id, prompt.id]);
	expect(picked.targets).toEqual([brief.id, prompt.id]);
	expect(picked.included.size).toBe(0);
	await expect(planGraph(graph, picked.targets)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
});
