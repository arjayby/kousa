import type {
	MediaInput,
	ResolvedInputs,
	ResolvedMediaInput,
} from "@kousa/db/schema/generation-inputs";
import type { CanvasDocument } from "@kousa/projects/canvas";
import { nodeGenerationKind } from "@kousa/projects/canvas";
import { graphDependencies } from "./graph-selection";
import {
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
	videoInputSnapshot,
} from "./input";
import { resolveMediaInputs } from "./media-inputs";

type Result = {
	id: string;
	nodeId: string;
	kind: string;
	output: string | null;
	assetId: string | null;
	resolvedInputs?: ResolvedInputs | null;
};
type Snapshot = {
	media?: MediaInput[];
	kind: string;
	modelId: string;
	content: string;
	sources: { id: string; content: string; runId?: string }[];
	size?: string | null;
	imageQuality?: string;
	voiceId?: string;
	voiceDirection?: string;
	duration?: number;
	aspectRatio?: string;
	image?: {
		nodeId: string;
		imageSource: string;
		assetId?: string | null;
	} | null;
};

export function inputSnapshot(graph: CanvasDocument, nodeId: string) {
	const kind = graph.nodes.find((node) => node.id === nodeId)?.type;
	if (kind === "video") return { kind, ...videoInputSnapshot(graph, nodeId) };
	if (kind === "audio")
		return { kind: "speech" as const, ...speechInputSnapshot(graph, nodeId) };
	if (kind === "image") return { kind, ...imageInputSnapshot(graph, nodeId) };
	return { kind: "text" as const, ...textInputSnapshot(graph, nodeId) };
}

export function resolveInputs(
	snapshot: Snapshot,
	outputs: Pick<Result, "id" | "nodeId" | "output">[],
	image?: { id: string; assetId: string | null } | null,
	media?: ResolvedMediaInput[],
): ResolvedInputs {
	return {
		version: 1,
		...(snapshot.media?.length
			? { media: media ?? resolveMediaInputs(snapshot.media) }
			: {}),
		settings: {
			kind: snapshot.kind,
			...(snapshot.imageQuality ? { imageQuality: snapshot.imageQuality } : {}),
			modelId: snapshot.modelId,
			content: snapshot.content,
			size: snapshot.kind === "image" ? (snapshot.size ?? null) : null,
			voiceId: snapshot.kind === "speech" ? (snapshot.voiceId ?? null) : null,
			voiceDirection:
				snapshot.kind === "speech" ? (snapshot.voiceDirection ?? null) : null,
			duration: snapshot.kind === "video" ? (snapshot.duration ?? null) : null,
			aspectRatio:
				snapshot.kind === "video" ? (snapshot.aspectRatio ?? null) : null,
		},
		text: snapshot.sources.map((source) => {
			const output = outputs.find((run) => run.nodeId === source.id);
			return {
				nodeId: source.id,
				runId: output?.id ?? null,
				content: output?.output ?? source.content,
			};
		}),
		image:
			(snapshot.kind === "video" || snapshot.kind === "image") && snapshot.image
				? {
						nodeId: snapshot.image.nodeId,
						runId:
							snapshot.image.imageSource === "project"
								? null
								: (image?.id ?? null),
						assetId:
							snapshot.image.imageSource === "project"
								? (snapshot.image.assetId ?? null)
								: (image?.assetId ??
									(snapshot.image.imageSource === "generated"
										? (snapshot.image.assetId ?? null)
										: null)),
					}
				: null,
	};
}

// JSONB does not preserve object key order. Arrays intentionally retain input order.
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

export async function fingerprint(value: unknown) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonical(value)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export type Freshness = {
	state: "current" | "outdated" | "missing" | "blocked";
	reason: string;
	runId?: string;
};

export function graphFreshness(graph: CanvasDocument, results: Result[]) {
	const byId = new Map(results.map((run) => [run.id, run]));
	const latest = new Map(results.map((run) => [run.nodeId, run]));
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const chosen = new Map<string, Result>();
	for (const node of graph.nodes) {
		const run = node.data.selectedRunId
			? byId.get(node.data.selectedRunId)
			: latest.get(node.id);
		if (run?.nodeId === node.id && run.kind === nodeGenerationKind(node.type))
			chosen.set(node.id, run);
	}
	const dependencies = graphDependencies(graph);
	const states = new Map<string, Freshness>();
	const visiting = new Set<string>();
	function visit(nodeId: string): Freshness {
		const saved = states.get(nodeId);
		if (saved) return saved;
		if (visiting.has(nodeId))
			return {
				state: "blocked",
				reason: "Disconnect the cycle before running.",
			};
		visiting.add(nodeId);
		const run = chosen.get(nodeId);
		let state: Freshness;
		try {
			const snapshot = inputSnapshot(graph, nodeId);
			const current = resolveInputs(
				snapshot,
				snapshot.sources.flatMap((source) => chosen.get(source.id) ?? []),
				(snapshot.kind === "video" || snapshot.kind === "image") &&
					snapshot.image
					? chosen.get(snapshot.image.nodeId)
					: null,
				resolveMediaInputs("media" in snapshot ? snapshot.media : [], [
					...chosen.values(),
				]),
			);
			const previous = run?.resolvedInputs;
			const upstream = [...(dependencies.get(nodeId) ?? [])].find(
				(id) => visit(id).state !== "current",
			);
			const missingPin = snapshot.sources.find(
				(source) => source.runId && !chosen.has(source.id),
			);
			if (
				missingPin ||
				("media" in snapshot &&
					snapshot.media?.some(
						(input) => input.source === "history" && !chosen.has(input.nodeId),
					)) ||
				((snapshot.kind === "video" || snapshot.kind === "image") &&
					snapshot.image?.imageSource === "history" &&
					!chosen.has(snapshot.image.nodeId))
			) {
				state = {
					state: "blocked",
					reason: "A selected historical output is unavailable.",
				};
			} else if (!run) {
				state = { state: "missing", reason: "No successful result yet." };
			} else if (previous?.version !== 1) {
				state = {
					state: "outdated",
					reason: "Input history unavailable. Generate once to enable reuse.",
				};
			} else if (previous.settings.content !== current.settings.content) {
				state = { state: "outdated", reason: "Prompt changed." };
			} else if (canonical(previous.settings) !== canonical(current.settings)) {
				state = { state: "outdated", reason: "Generation settings changed." };
			} else if (
				canonical(previous.text.map((source) => source.nodeId)) !==
					canonical(current.text.map((source) => source.nodeId)) ||
				previous.image?.nodeId !== current.image?.nodeId
			) {
				state = { state: "outdated", reason: "Connections changed." };
			} else if (canonical(previous) !== canonical(current)) {
				state = {
					state: "outdated",
					reason: "Connected input or selected output changed.",
				};
			} else if (upstream) {
				state = {
					state: "outdated",
					reason: `Upstream result needs updating: ${nodes.get(upstream)?.data.label || "connected node"}.`,
				};
			} else {
				state = {
					state: "current",
					reason: "Inputs unchanged. Reuse at no charge.",
				};
			}
		} catch (error) {
			state = {
				state: "blocked",
				reason: error instanceof Error ? error.message : "Invalid inputs.",
			};
		}
		visiting.delete(nodeId);
		const result = { ...state, ...(run ? { runId: run.id } : {}) };
		states.set(nodeId, result);
		return result;
	}
	for (const node of graph.nodes) visit(node.id);
	return states;
}
