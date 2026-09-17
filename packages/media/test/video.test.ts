import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";
import { inspectVideo } from "../src/video";

const fixture = (name: string) =>
	new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
it("reads dimensions and duration from complete silent H.264 media", () => {
	expect(inspectVideo(fixture("clip.mp4"))).toEqual({
		width: 160,
		height: 90,
		durationMs: 5000,
	});
	expect(inspectVideo(fixture("clip-10s.mp4")).durationMs).toBe(10000);
});
it("rejects an audio-only MP4 and spoofed, truncated, or oversized output", () => {
	for (const bytes of [
		fixture("audio-only.mp4"),
		new TextEncoder().encode("not a video"),
		fixture("clip.mp4").slice(0, -1),
		new Uint8Array(21 * 1024 * 1024),
	])
		expect(() => inspectVideo(new Uint8Array(bytes))).toThrow();
});
it("rejects samples missing from a syntactically complete mdat box", () => {
	const bytes = fixture("clip.mp4");
	const marker = Buffer.from(bytes).indexOf("mdat");
	const shorter = bytes.slice(0, -100);
	new DataView(shorter.buffer).setUint32(
		marker - 4,
		bytes.length - (marker - 4) - 100,
	);
	expect(() => inspectVideo(shorter)).toThrow("Incomplete video samples");
});
