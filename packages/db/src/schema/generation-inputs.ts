// Versioned provider inputs. Stored with the run so later canvas edits cannot
// change what it consumed. Run IDs distinguish even identical generated text.
export type MediaInput = {
	nodeId: string;
	output?: "lastFrame" | "audio";
	kind: "image" | "video" | "audio";
	role:
		| "context"
		| "reference"
		| "firstFrame"
		| "lastFrame"
		| "video"
		| "audioReference";
	source: "project" | "generated" | "history";
	runId?: string;
	assetId?: string | null;
};
export type ResolvedMediaInput = Omit<
	MediaInput,
	"source" | "runId" | "assetId"
> & { runId: string | null; assetId: string | null };

export type ResolvedInputs = {
	media?: ResolvedMediaInput[];
	version: 1;
	settings: {
		kind: string;
		modelId: string;
		content: string;
		size: string | null;
		imageQuality?: string;
		voiceId: string | null;
		voiceDirection: string | null;
		duration: number | null;
		aspectRatio: string | null;
	};
	text: { nodeId: string; runId: string | null; content: string }[];
	image: {
		nodeId: string;
		runId: string | null;
		assetId: string | null;
	} | null;
};
