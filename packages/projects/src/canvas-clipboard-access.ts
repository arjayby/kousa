import { parseCanvasClipboard } from "./canvas-clipboard";

type ClipboardSource = "system" | "canvas";

// The transport is injected so browser permission failures can be tested.
export function createCanvasClipboardAccess() {
	let copied: { userId: string; text: string } | null = null;
	const remember = (userId: string, text: string) => {
		copied = parseCanvasClipboard(text) ? { userId, text } : null;
	};
	return {
		remember,
		forget(userId: string) {
			if (copied?.userId === userId) copied = null;
		},
		async copy(
			userId: string,
			text: string,
			write: (text: string) => Promise<void>,
		): Promise<ClipboardSource> {
			remember(userId, text);
			try {
				await write(text);
				return "system";
			} catch {
				return "canvas";
			}
		},
		async read(
			userId: string,
			read: () => Promise<string>,
		): Promise<{ text: string; source: ClipboardSource }> {
			const before = copied;
			try {
				const text = await read();
				// A slow system read must not overwrite a more recent copy.
				if (copied === before) remember(userId, text);
				return { text, source: "system" };
			} catch (error) {
				if (copied?.userId === userId)
					return { text: copied.text, source: "canvas" };
				throw error;
			}
		},
	};
}
