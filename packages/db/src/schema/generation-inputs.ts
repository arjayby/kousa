// Versioned provider inputs. Stored with the run so later canvas edits cannot
// change what it consumed. Run IDs distinguish even identical generated text.
export type ResolvedInputs = {
	version: 1;
	settings: {
		kind: string;
		modelId: string;
		content: string;
		size: string | null;
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
