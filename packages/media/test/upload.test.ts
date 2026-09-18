import { afterEach, describe, expect, it, vi } from "vitest";
import { maxImageBytes, maxVideoBytes } from "../src/contracts";
import { uploadFileError, uploadProjectMedia } from "../src/upload";

afterEach(() => vi.unstubAllGlobals());
describe("shared canvas upload path", () => {
	it("accepts only supported media within limits", () => {
		for (const type of [
			"image/png",
			"image/jpeg",
			"image/webp",
			"audio/mpeg",
			"video/mp4",
		])
			expect(uploadFileError({ type, size: 1 })).toBeNull();
		expect(uploadFileError({ type: "image/svg+xml", size: 1 })).toContain(
			"Unsupported",
		);
		expect(uploadFileError({ type: "image/png", size: 0 })).toContain("empty");
		expect(
			uploadFileError({ type: "image/png", size: maxImageBytes + 1 }),
		).toContain("10 MB");
		expect(
			uploadFileError({ type: "video/mp4", size: maxVideoBytes + 1 }),
		).toContain("20 MB");
	});
	it("does not send invalid files", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(
			uploadProjectMedia(
				"project",
				new File(["svg"], "test.svg", { type: "image/svg+xml" }),
			),
		).rejects.toThrow("Unsupported");
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("preserves bytes, MIME and filename through the authenticated upload route", async () => {
		const asset = {
			id: crypto.randomUUID(),
			name: "sun rise.png",
			mimeType: "image/png",
			bytes: 3,
			width: 1,
			height: 1,
			durationMs: null,
		};
		const fetcher = vi
			.fn()
			.mockResolvedValue(Response.json({ asset }, { status: 201 }));
		vi.stubGlobal("fetch", fetcher);
		const file = new File(["png"], asset.name, { type: asset.mimeType });
		expect(await uploadProjectMedia("project", file)).toEqual(asset);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/projects/project/media",
			expect.objectContaining({
				method: "POST",
				body: file,
				headers: {
					"Content-Type": "image/png",
					"X-File-Name": "sun%20rise.png",
				},
			}),
		);
	});
	it("keeps authoritative validation and permission errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ message: "Only editors can upload." },
						{ status: 403 },
					),
				),
		);
		await expect(
			uploadProjectMedia(
				"project",
				new File(["png"], "x.png", { type: "image/png" }),
			),
		).rejects.toThrow("Only editors can upload.");
	});
	it("directs ambiguous network or malformed success responses to retry the same file", async () => {
		const file = new File(["png"], "x.png", { type: "image/png" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
		);
		await expect(uploadProjectMedia("project", file)).rejects.toThrow(
			"retry the same file",
		);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
		await expect(uploadProjectMedia("project", file)).rejects.toThrow(
			"Retry the same file",
		);
	});
});
