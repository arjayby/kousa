import { expect, it } from "vitest";
import { createCanvasNode, emptyCanvas } from "../src/canvas";
import {
	copyCanvasSelection,
	parseCanvasClipboard,
	pasteCanvasSelection,
} from "../src/canvas-clipboard";
import { createCanvasClipboardAccess } from "../src/canvas-clipboard-access";

const projectId = crypto.randomUUID();
function selection() {
	const node = createCanvasNode("text", { x: 0, y: 0 });
	node.data.content = "Copied via the toolbar";
	return JSON.stringify(
		copyCanvasSelection(
			{ ...emptyCanvas(), nodes: [node] },
			[node.id],
			projectId,
		),
	);
}
const denied = async () => {
	throw new Error("Clipboard permission denied");
};

it("pastes the toolbar copy when system clipboard reading is denied", async () => {
	const clipboard = createCanvasClipboardAccess();
	await clipboard.copy("alice", selection(), async () => {});
	const read = await clipboard.read("alice", denied);
	expect(read.source).toBe("canvas");
	const copied = parseCanvasClipboard(read.text);
	if (!copied) throw new Error("Expected a canvas selection");
	expect(
		pasteCanvasSelection(copied, emptyCanvas(), projectId).nodes[0]?.data
			.content,
	).toBe("Copied via the toolbar");
});

it("keeps icon copy/paste working when both browser operations are denied", async () => {
	const clipboard = createCanvasClipboardAccess();
	const text = selection();
	expect(await clipboard.copy("alice", text, denied)).toBe("canvas");
	expect(await clipboard.read("alice", denied)).toEqual({
		text,
		source: "canvas",
	});
});

it("honors newer system clipboard content and clears a stale canvas fallback", async () => {
	const clipboard = createCanvasClipboardAccess();
	await clipboard.copy("alice", selection(), async () => {});
	expect(await clipboard.read("alice", async () => "ordinary text")).toEqual({
		text: "ordinary text",
		source: "system",
	});
	await expect(clipboard.read("alice", denied)).rejects.toThrow(
		"permission denied",
	);
});

it("shares keyboard copies with toolbar paste without crossing accounts", async () => {
	const clipboard = createCanvasClipboardAccess();
	const text = selection();
	clipboard.remember("alice", text);
	await expect(clipboard.read("bob", denied)).rejects.toThrow(
		"permission denied",
	);
	clipboard.remember("alice", text);
	expect(await clipboard.read("alice", denied)).toEqual({
		text,
		source: "canvas",
	});
	clipboard.forget("alice");
	await expect(clipboard.read("alice", denied)).rejects.toThrow(
		"permission denied",
	);
});

it("remembers only valid canvas selections from native paste", async () => {
	const clipboard = createCanvasClipboardAccess();
	const text = selection();
	expect(await clipboard.read("alice", async () => text)).toEqual({
		text,
		source: "system",
	});
	expect(await clipboard.read("alice", denied)).toEqual({
		text,
		source: "canvas",
	});
	clipboard.remember("alice", "ordinary text");
	await expect(clipboard.read("alice", denied)).rejects.toThrow(
		"permission denied",
	);
});

it("does not replace a newer copy when a slow clipboard read finishes", async () => {
	const clipboard = createCanvasClipboardAccess();
	const oldText = selection();
	let finishRead!: (text: string) => void;
	const pending = clipboard.read(
		"alice",
		() =>
			new Promise<string>((resolve) => {
				finishRead = resolve;
			}),
	);
	const newText = selection();
	clipboard.remember("alice", newText);
	finishRead(oldText);
	expect(await pending).toEqual({ text: oldText, source: "system" });
	expect(await clipboard.read("alice", denied)).toEqual({
		text: newText,
		source: "canvas",
	});
});
