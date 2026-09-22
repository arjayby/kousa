import { describe, expect, it } from "vitest";
import { createCanvasNode } from "../src/canvas";
import { searchCanvasNodes } from "../src/canvas-search";

describe("canvas node search", () => {
	const text = createCanvasNode("text", { x: -50_000, y: 50_000 });
	text.data.label = "Coastal idea";
	text.data.content = "Pastel houses beside the sea at sunrise.";
	const image = createCanvasNode("image", { x: 500, y: 0 });
	image.data.label = "First frame";
	image.data.content = "Soft film grain.";
	const speech = createCanvasNode("audio", { x: 0, y: 0 });
	speech.data.label = "Narration";
	speech.data.voiceDirection = "Quiet, reassuring voice.";
	const nodes = [text, image, speech];
	const ids = (query: string) =>
		searchCanvasNodes(nodes, query).map(({ node }) => node.id);

	it("matches names, types, prompts, and speech direction regardless of case or position", () => {
		expect(ids("COASTAL")).toEqual([text.id]);
		expect(ids("Image")).toEqual([image.id]);
		expect(ids("sunrise")).toEqual([text.id]);
		expect(ids("reassuring")).toEqual([speech.id]);
	});
	it("requires every term, including terms across different fields", () => {
		expect(ids("  frame\n IMAGE   grain ")).toEqual([image.id]);
		expect(ids("coastal image")).toEqual([]);
	});
	it("shows all nodes for a blank query and handles an empty graph", () => {
		expect(ids(" \n ")).toEqual(nodes.map((node) => node.id));
		expect(searchCanvasNodes([], "text")).toEqual([]);
	});
	it("keeps duplicate names distinct and reads the current graph", () => {
		const duplicate = { ...text, id: crypto.randomUUID() };
		expect(searchCanvasNodes([text, duplicate], "coastal")).toHaveLength(2);
		const renamed = { ...text, data: { ...text.data, label: "Harbor idea" } };
		expect(searchCanvasNodes([renamed], "coastal")).toEqual([]);
		expect(searchCanvasNodes([renamed], "harbor")[0]?.node.id).toBe(text.id);
	});
	it("shows a bounded excerpt around a prompt match, even deep in a long prompt", () => {
		const long = {
			...image,
			data: {
				...image.data,
				content: `${"opening ".repeat(100)}silver moon ${"ending ".repeat(100)}`,
			},
		};
		const preview = searchCanvasNodes([long], "silver")[0]?.excerpt;
		expect(preview).toContain("silver moon");
		expect(preview?.length).toBeLessThanOrEqual(162);
		expect(preview).toMatch(/^….*…$/);
		expect(long.data.content).toContain("opening ".repeat(100));
	});
	it("treats punctuation literally and normalizes prompt whitespace", () => {
		const node = {
			...image,
			data: { ...image.data, content: "A [sun]\n\t rises." },
		};
		expect(searchCanvasNodes([node], "[sun]")[0]?.excerpt).toBe(
			"A [sun] rises.",
		);
		expect(searchCanvasNodes([node], ".*")).toEqual([]);
	});
	it("keeps short prompts whole when the match is near the end", () => {
		const node = {
			...image,
			data: {
				...image.data,
				content: "Watercolor illustration with a soft paper texture.",
			},
		};
		expect(searchCanvasNodes([node], "texture")[0]?.excerpt).toBe(
			node.data.content,
		);
	});
});
