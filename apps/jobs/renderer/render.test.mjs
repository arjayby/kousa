import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { renderClip } from "./render.mjs";

const exec = promisify(execFile);
const fixture = (name) =>
	readFile(
		new URL(`../../../packages/media/test/fixtures/${name}`, import.meta.url),
	);
const settings = { narrationStartMs: 1000, narrationVolume: 1, videoVolume: 0 };
async function pcm(path) {
	const { stdout } = await exec(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			path,
			"-vn",
			"-f",
			"f32le",
			"-ac",
			"1",
			"-ar",
			"8000",
			"pipe:1",
		],
		{ encoding: "buffer" },
	);
	return new Float32Array(
		stdout.buffer.slice(
			stdout.byteOffset,
			stdout.byteOffset + stdout.byteLength,
		),
	);
}
function rms(samples, start, end) {
	const part = samples.slice(Math.round(start * 8000), Math.round(end * 8000));
	return Math.sqrt(
		part.reduce((sum, sample) => sum + sample * sample, 0) / part.length,
	);
}
async function videoHash(path) {
	return (
		await exec("ffmpeg", [
			"-v",
			"error",
			"-i",
			path,
			"-map",
			"0:v:0",
			"-c",
			"copy",
			"-f",
			"hash",
			"-hash",
			"sha256",
			"pipe:1",
		])
	).stdout;
}
test("exports H.264/AAC without re-encoding video; delays, scales, pads and trims narration", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kousa-render-test-"));
	try {
		const [video, audio] = await Promise.all([
			fixture("clip.mp4"),
			fixture("tone.mp3"),
		]);
		const source = join(dir, "source.mp4");
		const full = join(dir, "full.mp4");
		const half = join(dir, "half.mp4");
		await writeFile(source, video);
		await writeFile(full, await renderClip(video, audio, settings));
		await writeFile(
			half,
			await renderClip(video, audio, { ...settings, narrationVolume: 0.5 }),
		);
		const metadata = JSON.parse(
			(
				await exec("ffprobe", [
					"-v",
					"error",
					"-show_streams",
					"-of",
					"json",
					full,
				])
			).stdout,
		);
		assert.deepEqual(
			metadata.streams.map((s) => s.codec_name),
			["h264", "aac"],
		);
		assert.equal(Number(metadata.streams[0].duration), 5);
		assert.equal(await videoHash(source), await videoHash(full));
		const [a, b] = await Promise.all([pcm(full), pcm(half)]);
		assert.ok(rms(a, 0.1, 0.8) < 0.0001, "audio is silent before the offset");
		assert.ok(
			rms(a, 1.1, 1.5) > 0.01,
			"narration plays at the requested offset",
		);
		assert.ok(
			Math.abs(rms(b, 1.1, 1.5) / rms(a, 1.1, 1.5) - 0.5) < 0.03,
			"50% volume halves amplitude",
		);
		assert.ok(
			rms(a, 4, 4.8) < 0.0001,
			"short narration is padded with silence",
		);
		const trimmed = join(dir, "trimmed.mp4");
		await writeFile(
			trimmed,
			await renderClip(video, audio, { ...settings, narrationStartMs: 4900 }),
		);
		const samples = await pcm(trimmed);
		assert.ok(
			samples.length / 8000 < 5.05,
			"narration never extends the video",
		);
		assert.ok(
			rms(samples, 4.93, 4.98) > 0.005,
			"tail narration remains audible",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
test("keeps or mutes the original soundtrack independently of narration", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kousa-mix-test-"));
	try {
		const [video, audio] = await Promise.all([
			fixture("narrated-clip.mp4"),
			fixture("tone.mp3"),
		]);
		const keep = join(dir, "keep.mp4");
		const mute = join(dir, "mute.mp4");
		await writeFile(
			keep,
			await renderClip(video, audio, {
				...settings,
				narrationVolume: 0,
				videoVolume: 1,
			}),
		);
		await writeFile(
			mute,
			await renderClip(video, audio, {
				...settings,
				narrationVolume: 0,
				videoVolume: 0,
			}),
		);
		assert.ok(rms(await pcm(keep), 1.1, 1.5) > 0.01);
		assert.ok(rms(await pcm(mute), 1.1, 1.5) < 0.0001);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
test("rejects invalid media, out-of-range controls and offsets after video ends", async () => {
	const [video, audio] = await Promise.all([
		fixture("clip.mp4"),
		fixture("tone.mp3"),
	]);
	for (const patch of [
		{ narrationVolume: -1 },
		{ videoVolume: Number.POSITIVE_INFINITY },
		{ narrationStartMs: 0.5 },
		{ narrationStartMs: 5000 },
	]) {
		await assert.rejects(renderClip(video, audio, { ...settings, ...patch }));
	}
	await assert.rejects(renderClip(new Uint8Array(), audio, settings));
	await assert.rejects(
		renderClip(video, new TextEncoder().encode("not audio"), settings),
	);
});
