// Single byte ranges cover native audio seeking. Invalid and multipart requests
// are rejected only after project and asset access have been checked.
export class MediaRangeError extends Error {
	constructor(public total: number) {
		super("Requested byte range is unavailable.");
	}
}
export function parseMediaRange(
	header: string | null | undefined,
	total: number,
) {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match || (!match[1] && !match[2])) throw new MediaRangeError(total);
	let start = Number(match[1]);
	let end = match[2] ? Number(match[2]) : total - 1;
	if (!match[1]) {
		if (!Number.isSafeInteger(end) || end < 1) throw new MediaRangeError(total);
		start = Math.max(0, total - end);
		end = total - 1;
	}
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start >= total ||
		end < start
	)
		throw new MediaRangeError(total);
	end = Math.min(end, total - 1);
	return { offset: start, length: end - start + 1 };
}
