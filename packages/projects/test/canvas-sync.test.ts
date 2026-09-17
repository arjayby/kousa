import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasNode, emptyCanvas } from "../src/canvas";
import { createCanvasSync, type SavedCanvas } from "../src/canvas-sync";

const initial: SavedCanvas = {
	document: emptyCanvas(),
	revision: 0,
	updatedAt: null,
};
const edited = () => ({
	...emptyCanvas(),
	nodes: [createCanvasNode("text", { x: 1, y: 2 })],
});
function setup() {
	const save = vi.fn(
		async (
			document: SavedCanvas["document"],
			revision: number,
		): Promise<SavedCanvas> => ({
			document,
			revision: revision + 1,
			updatedAt: new Date(),
		}),
	);
	const replace = vi.fn();
	return {
		save,
		replace,
		sync: createCanvasSync({ initial, canEdit: true, save, replace }),
	};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("canvas autosave coordination", () => {
	it("debounces edits, saves the latest graph, and ignores transient unchanged documents", async () => {
		const { sync, save } = setup();
		sync.edit(edited());
		await vi.advanceTimersByTimeAsync(500);
		const latest = edited();
		sync.edit(latest);
		await vi.advanceTimersByTimeAsync(699);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledExactlyOnceWith(latest, 0);
		expect(sync.getSnapshot()).toMatchObject({
			status: "saved",
			revision: 1,
			dirty: false,
		});
		sync.edit(structuredClone(latest));
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
	});
	it("serializes saves while retaining edits made during an in-flight request", async () => {
		const { sync, save } = setup();
		let resolve!: (value: SavedCanvas) => void;
		save.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const first = edited();
		sync.edit(first);
		await vi.advanceTimersByTimeAsync(700);
		const second = edited();
		sync.edit(second);
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
		resolve({ document: first, revision: 1, updatedAt: new Date() });
		await vi.advanceTimersByTimeAsync(700);
		expect(save).toHaveBeenLastCalledWith(second, 1);
		expect(sync.getSnapshot()).toMatchObject({ status: "saved", revision: 2 });
	});
	it("preserves pending edits on a conflict and never retries over someone else's work", async () => {
		const { sync, save, replace } = setup();
		save.mockRejectedValueOnce({ code: "CONFLICT" });
		sync.edit(edited());
		await vi.advanceTimersByTimeAsync(700);
		sync.retry();
		await vi.advanceTimersByTimeAsync(2000);
		expect(save).toHaveBeenCalledTimes(1);
		expect(sync.getSnapshot()).toMatchObject({
			status: "conflict",
			dirty: true,
		});
		expect(replace).not.toHaveBeenCalled();
	});
	it("receives saved updates only when clean, and ignores older reads", () => {
		const { sync, replace } = setup();
		const remote = { document: edited(), revision: 2, updatedAt: new Date() };
		sync.receive(remote);
		sync.receive(initial);
		expect(replace).toHaveBeenCalledExactlyOnceWith(remote.document);
		expect(sync.getSnapshot().revision).toBe(2);
		sync.edit(edited());
		sync.receive({ document: edited(), revision: 3, updatedAt: new Date() });
		expect(sync.getSnapshot()).toMatchObject({
			status: "conflict",
			revision: 2,
			dirty: true,
		});
		expect(replace).toHaveBeenCalledTimes(1);
	});
	it("requires an explicit retry after a network failure and recognizes a lost save acknowledgement", async () => {
		const { sync, save } = setup();
		save.mockRejectedValueOnce(new Error("offline"));
		const document = edited();
		sync.edit(document);
		await vi.advanceTimersByTimeAsync(2000);
		expect(save).toHaveBeenCalledTimes(1);
		expect(sync.getSnapshot()).toMatchObject({ status: "error", dirty: true });
		sync.receive({ document, revision: 1, updatedAt: new Date() });
		expect(sync.getSnapshot()).toMatchObject({ status: "saved", dirty: false });
		sync.edit(edited());
		save.mockRejectedValueOnce(new Error("offline"));
		await vi.advanceTimersByTimeAsync(700);
		sync.retry();
		await vi.advanceTimersByTimeAsync(0);
		expect(sync.getSnapshot()).toMatchObject({ status: "saved", revision: 2 });
	});
	it("does not save for viewers or after a permission change", async () => {
		const { sync, save } = setup();
		sync.edit(edited());
		sync.setCanEdit(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).not.toHaveBeenCalled();
		expect(sync.getSnapshot().status).toBe("forbidden");
		sync.setCanEdit(true);
		save.mockRejectedValueOnce({ code: "FORBIDDEN" });
		sync.retry();
		await vi.advanceTimersByTimeAsync(0);
		expect(sync.getSnapshot().status).toBe("forbidden");
		sync.edit(edited());
		sync.retry();
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
	});
	it("cancels queued saves when the editor is unmounted", async () => {
		const { sync, save } = setup();
		sync.edit(edited());
		sync.setActive(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).not.toHaveBeenCalled();
	});
	it("keeps a rejected writer disabled when loading a saved version until access is confirmed", async () => {
		const { sync, save } = setup();
		save.mockRejectedValueOnce({ code: "FORBIDDEN" });
		sync.edit(edited());
		await vi.advanceTimersByTimeAsync(700);
		sync.reset(initial);
		expect(sync.getSnapshot().status).toBe("forbidden");
		sync.edit(edited());
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
		sync.setCanEdit(true);
		sync.reset(initial);
		sync.edit(edited());
		await vi.advanceTimersByTimeAsync(700);
		expect(sync.getSnapshot()).toMatchObject({ status: "saved", revision: 1 });
	});
	it("does not resume queued changes if edit access is revoked during an in-flight save", async () => {
		const { sync, save } = setup();
		let resolve!: (value: SavedCanvas) => void;
		save.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const first = edited();
		sync.edit(first);
		await vi.advanceTimersByTimeAsync(700);
		sync.edit(edited());
		sync.setCanEdit(false);
		resolve({ document: first, revision: 1, updatedAt: new Date() });
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
		expect(sync.getSnapshot()).toMatchObject({
			status: "forbidden",
			dirty: true,
		});
	});
	it("handles a newer remote read arriving during a save without regressing the revision", async () => {
		const { sync, save, replace } = setup();
		let resolve!: (value: SavedCanvas) => void;
		save.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const document = edited();
		sync.edit(document);
		await vi.advanceTimersByTimeAsync(700);
		const newer = { document: edited(), revision: 2, updatedAt: new Date() };
		sync.receive(newer);
		resolve({ document, revision: 1, updatedAt: new Date() });
		await vi.advanceTimersByTimeAsync(0);
		expect(sync.getSnapshot()).toMatchObject({ status: "saved", revision: 2 });
		expect(replace).toHaveBeenCalledWith(newer.document);
	});
});
