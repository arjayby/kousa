import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const run = (command, args) =>
	exec(command, args, { timeout: 150_000, maxBuffer: 1024 * 1024 });
async function probe(path) {
	const { stdout } = await run("ffprobe", [
		"-v",
		"error",
		"-protocol_whitelist",
		"file,pipe",
		"-show_streams",
		"-show_format",
		"-of",
		"json",
		path,
	]);
	return JSON.parse(stdout);
}
export async function renderClip(video, audio, settings) {
	if (
		!video.length ||
		video.length > 20 * 1024 * 1024 ||
		!audio.length ||
		audio.length > 10 * 1024 * 1024
	)
		throw new Error("Invalid input size");
	const { narrationStartMs, narrationVolume, videoVolume } = settings;
	if (
		!Number.isInteger(narrationStartMs) ||
		narrationStartMs < 0 ||
		narrationStartMs >= 12000 ||
		![narrationVolume, videoVolume].every(
			(v) => Number.isFinite(v) && v >= 0 && v <= 2,
		)
	)
		throw new Error("Invalid clip settings");
	const dir = await mkdtemp(join(tmpdir(), "kousa-clip-"));
	try {
		const videoPath = join(dir, "video.mp4");
		const audioPath = join(dir, "speech.mp3");
		const outputPath = join(dir, "clip.mp4");
		await Promise.all([
			writeFile(videoPath, video),
			writeFile(audioPath, audio),
		]);
		const [v, a] = await Promise.all([probe(videoPath), probe(audioPath)]);
		const tracks = v.streams.filter((s) => s.codec_type === "video");
		const track = tracks[0];
		const duration = Number(track?.duration);
		if (
			tracks.length !== 1 ||
			track.codec_name !== "h264" ||
			track.width > 1920 ||
			track.height > 1920 ||
			!Number.isFinite(duration) ||
			duration <= 0 ||
			duration > 12 ||
			narrationStartMs / 1000 >= duration
		)
			throw new Error("Invalid source video");
		if (
			a.streams.length !== 1 ||
			a.streams[0].codec_name !== "mp3" ||
			Number(a.format.duration) > 180
		)
			throw new Error("Invalid narration");
		const delay = narrationStartMs / 1000;
		const narration = `[1:a:0]atrim=duration=${duration - delay},asetpts=PTS-STARTPTS,volume=${narrationVolume},adelay=${narrationStartMs}:all=1,apad,atrim=duration=${duration}[voice]`;
		const hasAudio = v.streams.some((s) => s.codec_type === "audio");
		const mix =
			hasAudio && videoVolume > 0
				? `${narration};[0:a:0]asetpts=PTS-STARTPTS,volume=${videoVolume},apad,atrim=duration=${duration}[original];[original][voice]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=false[out]`
				: `${narration};[voice]alimiter=limit=0.95:level=false[out]`;
		await run("ffmpeg", [
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-y",
			"-protocol_whitelist",
			"file,pipe",
			"-i",
			videoPath,
			"-protocol_whitelist",
			"file,pipe",
			"-i",
			audioPath,
			"-filter_complex",
			mix,
			"-map",
			"0:v:0",
			"-map",
			"[out]",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"128k",
			"-ar",
			"48000",
			"-ac",
			"2",
			"-t",
			String(duration),
			"-map_metadata",
			"-1",
			"-movflags",
			"+faststart",
			"-threads",
			"1",
			outputPath,
		]);
		const bytes = await readFile(outputPath);
		if (bytes.length > 20 * 1024 * 1024)
			throw new Error("Rendered clip exceeds 20 MB");
		return bytes;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// Decode only saved MP4 bytes; FFmpeg cannot fetch network inputs.
export async function extractVideoOutput(video, output) {
	if (
		!video.length ||
		video.length > 20 * 1024 * 1024 ||
		!["lastFrame", "audio"].includes(output)
	)
		throw new Error("Invalid video output request");
	const dir = await mkdtemp(join(tmpdir(), "kousa-extract-"));
	try {
		const input = join(dir, "input.mp4");
		const path = join(dir, output === "lastFrame" ? "frame.png" : "audio.mp3");
		await writeFile(input, video);
		const info = await probe(input);
		const tracks = info.streams.filter((track) => track.codec_type === "video");
		const track = tracks[0];
		const duration = Number(track?.duration);
		if (
			tracks.length !== 1 ||
			track.codec_name !== "h264" ||
			track.width > 1920 ||
			track.height > 1920 ||
			!Number.isFinite(duration) ||
			duration <= 0 ||
			duration > 12
		)
			throw new Error("Invalid video input");
		if (
			output === "audio" &&
			!info.streams.some((track) => track.codec_type === "audio")
		)
			throw new Error("This video has no audio track");
		const args =
			output === "lastFrame"
				? [
						"-ss",
						String(Math.max(0, duration - 1)),
						"-i",
						input,
						"-update",
						"1",
						"-an",
						"-c:v",
						"png",
					]
				: [
						"-i",
						input,
						"-map",
						"0:a:0",
						"-vn",
						"-c:a",
						"libmp3lame",
						"-b:a",
						"128k",
						"-ar",
						"44100",
						"-ac",
						"2",
						"-t",
						String(duration),
					];
		await run("ffmpeg", [
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-y",
			"-protocol_whitelist",
			"file,pipe",
			...args,
			"-map_metadata",
			"-1",
			"-threads",
			"1",
			path,
		]);
		const bytes = await readFile(path);
		if (!bytes.length || bytes.length > 10 * 1024 * 1024)
			throw new Error("Extracted output too large");
		return bytes;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
