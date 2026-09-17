import type { GraphStep } from "@kousa/db/schema/graph-runs";
import type { CanvasDocument } from "@kousa/projects/canvas";
import { z } from "zod";
import {
	imageCreditCost,
	imageModels,
	speechCreditCost,
	speechModels,
	speechVoices,
	textCreditCost,
	textModels,
	videoAspectRatios,
	videoCreditCost,
	videoDurations,
	videoModels,
} from "./contracts";
import {
	buildImagePrompt,
	buildPrompt,
	buildSpeechScript,
	buildVideoPrompt,
	GenerationError,
	generationInputHash,
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
	videoInputSnapshot,
} from "./input";

export const graphProjectInput = z.object({ projectId: z.uuid() });
export const graphPreviewInput = graphProjectInput
	.extend({
		nodeId: z.uuid().optional(),
		nodeIds: z
			.array(z.uuid())
			.min(1)
			.max(20)
			.refine(
				(ids) => new Set(ids).size === ids.length,
				"Choose each output only once.",
			)
			.optional(),
		resumeOf: z.uuid().optional(),
		inputHash: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
	})
	.refine(
		(input) => (input.nodeId !== undefined) !== (input.nodeIds !== undefined),
		"Choose one node or a list of outputs.",
	);
export const graphStartInput = graphPreviewInput.safeExtend({
	id: z.uuid(),
	inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export function graphTargetIds(input: { nodeId?: string; nodeIds?: string[] }) {
	return [...(input.nodeIds ?? (input.nodeId ? [input.nodeId] : []))].sort();
}

// Old saved runs have no target markers and still resume their original output.
export function graphRunTargetIds(run: { nodeId: string; plan: GraphStep[] }) {
	const targets = run.plan
		.filter((step) => step.target)
		.map((step) => step.nodeId);
	return targets.length ? targets.sort() : [run.nodeId];
}

export function graphOutputIds(graph: Pick<CanvasDocument, "nodes" | "edges">) {
	const sources = new Set(graph.edges.map((edge) => edge.source));
	return graph.nodes
		.filter((node) => !sources.has(node.id))
		.map((node) => node.id);
}

export async function planGraph(
	graph: CanvasDocument,
	target: string | string[],
) {
	const targets = [
		...new Set(typeof target === "string" ? [target] : target),
	].sort();
	if (!targets.length || targets.length > 20)
		throw new GenerationError(
			"BAD_REQUEST",
			"Choose between 1 and 20 workflow outputs.",
		);
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: string[] = [];
	function visit(id: string) {
		if (visiting.has(id))
			throw new GenerationError(
				"BAD_REQUEST",
				"Disconnect the cycle before running this workflow.",
			);
		if (visited.has(id)) return;
		const node = nodes.get(id);
		if (!node)
			throw new GenerationError(
				"BAD_REQUEST",
				"A workflow node is missing. Refresh the canvas.",
			);
		if (
			node.type !== "text" &&
			node.type !== "image" &&
			node.type !== "video" &&
			node.type !== "speech"
		)
			throw new GenerationError(
				"BAD_REQUEST",
				"Choose text, image, video, or speech nodes for this workflow.",
			);
		visiting.add(id);
		for (const edge of graph.edges
			.filter((edge) => edge.target === id)
			.sort((a, b) => a.id.localeCompare(b.id))) {
			const source = nodes.get(edge.source);
			// A selected project image is a fixed input, not a request to regenerate it.
			if (
				node.type === "video" &&
				edge.targetHandle === "image" &&
				source?.type === "image" &&
				(source.data.imageSource ??
					(source.data.assetId ? "project" : "generated")) === "project"
			)
				continue;
			visit(edge.source);
		}
		visiting.delete(id);
		visited.add(id);
		ordered.push(id);
		if (ordered.length > 20)
			throw new GenerationError(
				"BAD_REQUEST",
				"Run up to 20 connected nodes at a time.",
			);
	}
	for (const targetId of targets) visit(targetId);
	const plan: GraphStep[] = await Promise.all(
		ordered.map(async (nodeId): Promise<GraphStep> => {
			const node = nodes.get(nodeId);
			if (!node) throw new Error("Missing planned node");
			if (node.type === "speech") {
				const snapshot = speechInputSnapshot(graph, nodeId);
				if (
					!speechModels.some((model) => model.id === snapshot.modelId) ||
					!speechVoices.some((voice) => voice.id === snapshot.voiceId)
				)
					throw new GenerationError(
						"BAD_REQUEST",
						"Choose an available speech model and voice.",
					);
				buildSpeechScript(snapshot, []);
				return {
					...snapshot,
					kind: "speech",
					target: targets.includes(nodeId),
					label: node.data.label,
					size: null,
					inputHash: await generationInputHash(graph, nodeId),
					credits: speechCreditCost,
					runId: "",
					reused: false,
				};
			}
			if (node.type === "video") {
				const snapshot = videoInputSnapshot(graph, nodeId);
				if (
					!videoModels.some((model) => model.id === snapshot.modelId) ||
					!videoDurations.some((duration) => duration === snapshot.duration) ||
					!videoAspectRatios.some((ratio) => ratio === snapshot.aspectRatio)
				)
					throw new GenerationError(
						"BAD_REQUEST",
						"Choose an available video model, duration, and aspect ratio.",
					);
				if (
					snapshot.image?.imageSource === "project" &&
					!snapshot.image.assetId
				)
					throw new GenerationError(
						"BAD_REQUEST",
						"Choose an available image on the connected image node first.",
					);
				buildVideoPrompt(snapshot, []);
				return {
					...snapshot,
					kind: "video",
					target: targets.includes(nodeId),
					label: node.data.label,
					size: null,
					inputHash: await generationInputHash(graph, nodeId),
					credits: videoCreditCost(snapshot.duration),
					runId: "",
					reused: false,
				};
			}
			const kind = node.type === "image" ? "image" : "text";
			const snapshot =
				kind === "image"
					? imageInputSnapshot(graph, nodeId)
					: textInputSnapshot(graph, nodeId);
			if (
				!(kind === "image" ? imageModels : textModels).some(
					(model) => model.id === snapshot.modelId,
				)
			)
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose an available model before running the workflow.",
				);
			// Validate written prompts before reserving. Generated context is validated
			// again when each step starts, since its length is not known in advance.
			if (kind === "image") buildImagePrompt(snapshot, []);
			else buildPrompt(snapshot, []);
			return {
				...snapshot,
				kind,
				target: targets.includes(nodeId),
				label: node.data.label,
				size:
					"size" in snapshot && typeof snapshot.size === "string"
						? snapshot.size
						: null,
				inputHash: await generationInputHash(graph, nodeId),
				credits: kind === "image" ? imageCreditCost : textCreditCost,
				runId: "",
				reused: false,
			};
		}),
	);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(
			JSON.stringify({
				targets,
				steps: plan.map(({ nodeId, inputHash, credits }) => ({
					nodeId,
					inputHash,
					credits,
				})),
			}),
		),
	);
	const inputHash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return { plan, inputHash };
}
