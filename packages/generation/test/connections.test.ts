import {
	type CanvasNode,
	createCanvasNode,
	emptyCanvas,
	inputPorts,
	type NodeKind,
	nodeGenerationKind,
	nodeKinds,
} from "@kousa/projects/canvas";
import { describe, expect, it } from "vitest";
import { connectedOutput, connectionCapability } from "../src/connections";
import type { PublicRun } from "../src/contracts";
import {
	buildImagePrompt,
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
	videoInputImageAssetId,
	videoInputSnapshot,
} from "../src/input";

const node = (kind: NodeKind) => createCanvasNode(kind, { x: 0, y: 0 });
const run = (
	source: CanvasNode,
	patch: Partial<PublicRun> = {},
): PublicRun => ({
	id: crypto.randomUUID(),
	nodeId: source.id,
	kind: nodeGenerationKind(source.type),
	status: "succeeded",
	output: "Saved output",
	assetId: crypto.randomUUID(),
	userId: "user",
	modelId: "model",
	transcript: null,
	voiceId: null,
	stage: "saving",
	error: null,
	credits: 1,
	createdAt: "2026-09-18T00:00:00Z",
	inputHash: "a".repeat(64),
	...patch,
});

describe("connection contributions", () => {
	it("uses the same capability rules in previews and every generation snapshot", () => {
		const snapshots = {
			text: textInputSnapshot,
			image: imageInputSnapshot,
			video: videoInputSnapshot,
			audio: speechInputSnapshot,
		};
		for (const kind of nodeKinds)
			for (const port of inputPorts[kind])
				for (const sourceKind of nodeKinds) {
					const source = node(sourceKind);
					const target = node(kind);
					const graph = {
						...emptyCanvas(),
						nodes: [source, target],
						edges: [
							{
								id: crypto.randomUUID(),
								source: source.id,
								target: target.id,
								sourceHandle: "output" as const,
								targetHandle: port.id,
							},
						],
					};
					const capability = connectionCapability(source, target, port.id);
					if (capability.usage === "unsupported")
						expect(() => snapshots[kind](graph, target.id)).toThrow(
							capability.description,
						);
					else expect(() => snapshots[kind](graph, target.id)).not.toThrow();
				}
	});
	it("previews the exact text used by single-node prompt resolution", () => {
		const source = node("text");
		const target = node("image");
		source.data.content = "Written text";
		const output = run(source);
		expect(connectedOutput(source).text).toBe("Written text");
		expect(connectedOutput(source, output)).toMatchObject({
			version: "Latest successful output",
			text: output.output,
			runId: output.id,
		});
		const graph = {
			...emptyCanvas(),
			nodes: [source, target],
			edges: [
				{
					id: crypto.randomUUID(),
					source: source.id,
					target: target.id,
					sourceHandle: "output" as const,
					targetHandle: "prompt",
				},
			],
		};
		expect(
			buildImagePrompt(imageInputSnapshot(graph, target.id), [output]),
		).toBe(connectedOutput(source, output).text);
		source.data.selectedRunId = output.id;
		expect(connectedOutput(source, output).version).toBe(
			"Selected historical output",
		);
		expect(connectedOutput(source, run(source))).toMatchObject({
			text: null,
			error: expect.stringContaining("unavailable"),
		});
		expect(connectedOutput(source)).toMatchObject({
			text: null,
			error: expect.stringContaining("unavailable"),
		});
	});
	it("resolves project, generated and historical starting images exactly as video generation does", () => {
		const source = node("image");
		const target = node("video");
		const output = run(source);
		const graph = {
			...emptyCanvas(),
			nodes: [source, target],
			edges: [
				{
					id: crypto.randomUUID(),
					source: source.id,
					target: target.id,
					sourceHandle: "output" as const,
					targetHandle: "image",
				},
			],
		};
		for (const imageSource of ["project", "generated"] as const) {
			source.data.imageSource = imageSource;
			source.data.assetId = crypto.randomUUID();
			expect(connectedOutput(source, output).assetId).toBe(
				videoInputImageAssetId(
					videoInputSnapshot(graph, target.id),
					output.assetId,
				),
			);
		}
		source.data.imageSource = "project";
		source.data.selectedRunId = output.id;
		expect(connectedOutput(source, output).assetId).toBe(
			videoInputImageAssetId(
				videoInputSnapshot(graph, target.id),
				output.assetId,
			),
		);
		expect(connectedOutput(source).assetId).toBeNull();
	});
	it("identifies speech as composition without adding it to video generation inputs", () => {
		const source = node("audio");
		const target = node("video");
		const graph = {
			...emptyCanvas(),
			nodes: [source, target],
			edges: [
				{
					id: crypto.randomUUID(),
					source: source.id,
					target: target.id,
					sourceHandle: "output" as const,
					targetHandle: "audio",
				},
			],
		};
		expect(connectionCapability(source, target, "audio")).toMatchObject({
			usage: "composition",
			description: expect.stringContaining("Create clip"),
		});
		expect(videoInputSnapshot(graph, target.id)).toMatchObject({
			sources: [],
			image: null,
		});
		source.data.mediaSource = "project";
		source.data.assetId = crypto.randomUUID();
		expect(connectedOutput(source, run(source))).toMatchObject({
			version: "Project asset",
			assetId: source.data.assetId,
			runId: null,
		});
	});
	it("rejects unknown models and resolves legacy text model selections", () => {
		const source = node("text");
		const target = node("text");
		target.data.textModel = "unknown";
		expect(connectionCapability(source, target, "context").usage).toBe(
			"unsupported",
		);
		target.data.textModel = "openai/gpt-4.1-mini";
		expect(connectionCapability(source, target, "context")).toMatchObject({
			usage: "text",
			model: "Nova Micro",
		});
	});
});
