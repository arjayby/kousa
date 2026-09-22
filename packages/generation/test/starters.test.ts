import { canvasDocumentSchema } from "@kousa/projects/canvas";
import { describe, expect, it } from "vitest";
import { resolveConnection } from "../src/connections";
import {
	imageInputSnapshot,
	speechInputSnapshot,
	videoInputSnapshot,
} from "../src/input";
import {
	createCanvasStarter,
	starterKinds,
	starterUnavailable,
} from "../src/starters";

describe("guided canvas examples", () => {
	it.each(starterKinds)(
		"creates a valid %s graph with inputs consumed by current generators",
		(kind) => {
			const example = createCanvasStarter(kind, { x: 10, y: 20 });
			expect(canvasDocumentSchema.safeParse(example.document).success).toBe(
				true,
			);
			for (const edge of example.document.edges) {
				const input = resolveConnection(example.document, edge);
				expect(input).not.toBeNull();
				expect(input?.usage).not.toBe("unsupported");
			}
			for (const step of example.steps) {
				const snapshot =
					step.kind === "image"
						? imageInputSnapshot
						: step.kind === "audio"
							? speechInputSnapshot
							: videoInputSnapshot;
				expect(() => snapshot(example.document, step.nodeId)).not.toThrow();
			}
		},
	);
	it("only offers image-to-video when image, video and provider access are available", () => {
		expect(
			starterUnavailable("image-video", {
				image: true,
				video: true,
				imageToVideo: false,
			}),
		).toContain("unavailable");
		expect(
			starterUnavailable("video", { video: true, imageToVideo: false }),
		).toBeNull();
		expect(starterUnavailable("speech", {})).toContain("Checking");
		expect(starterUnavailable("image", { image: false })).toContain(
			"unavailable",
		);
	});
	it("guides image generation before video and uses fresh node IDs for each example", () => {
		const example = createCanvasStarter("image-video");
		expect(example.steps.map((step) => step.kind)).toEqual(["image", "video"]);
		const other = createCanvasStarter("image-video");
		expect(
			other.document.nodes.every(
				(node) => !example.document.nodes.some((old) => old.id === node.id),
			),
		).toBe(true);
	});
});
