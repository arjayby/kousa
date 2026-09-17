import { createFile, type MP4BoxBuffer } from "mp4box";
import { maxVideoBytes, maxVideoDurationMs } from "./contracts";

// Metadata parsing is not decoding. Validate complete boxes and sample bounds
// too, so a truncated mdat cannot be published as a playable result.
export function inspectVideo(bytes: Uint8Array<ArrayBuffer>) {
	if (!bytes.length || bytes.length > maxVideoBytes)
		throw new Error("Invalid video size");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 0;
	const mediaRanges: Array<{ start: number; end: number }> = [];
	while (offset < bytes.length) {
		if (offset + 8 > bytes.length) throw new Error("Truncated MP4 box");
		let size = view.getUint32(offset);
		let header = 8;
		if (size === 1) {
			if (offset + 16 > bytes.length) throw new Error("Truncated MP4 box");
			size = Number(view.getBigUint64(offset + 8));
			header = 16;
		} else if (size === 0) size = bytes.length - offset;
		if (
			!Number.isSafeInteger(size) ||
			size < header ||
			offset + size > bytes.length
		)
			throw new Error("Truncated MP4 box");
		if (view.getUint32(offset + 4) === 0x6d646174)
			mediaRanges.push({ start: offset + header, end: offset + size });
		offset += size;
	}
	const file = createFile(false);
	file.onError = () => {
		throw new Error("Invalid MP4");
	};
	const buffer = bytes.slice().buffer as MP4BoxBuffer;
	buffer.fileStart = 0;
	file.appendBuffer(buffer, true);
	file.flush();
	const info = file.getInfo();
	const track = info.videoTracks[0];
	if (
		!info.hasMoov ||
		info.isFragmented ||
		info.videoTracks.length !== 1 ||
		info.audioTracks.length ||
		!track?.video ||
		!/^avc[13]\./.test(track.codec)
	)
		throw new Error("Expected silent H.264 MP4");
	const { width, height } = track.video;
	const durationMs = Math.ceil((track.duration / track.timescale) * 1000);
	if (
		![width, height, durationMs].every(Number.isSafeInteger) ||
		width < 1 ||
		height < 1 ||
		width > 1920 ||
		height > 1920 ||
		durationMs < 1 ||
		durationMs > maxVideoDurationMs
	)
		throw new Error("Invalid video dimensions or duration");
	const samples = file.getTrackSamplesInfo(track.id);
	if (
		!samples.length ||
		samples.length !== track.nb_samples ||
		samples.some(
			(s) =>
				!Number.isSafeInteger(s.offset) ||
				!Number.isSafeInteger(s.size) ||
				s.size <= 0 ||
				!mediaRanges.some(
					(r) => s.offset >= r.start && s.offset + s.size <= r.end,
				),
		)
	)
		throw new Error("Incomplete video samples");
	return { width, height, durationMs };
}
