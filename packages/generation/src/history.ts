import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { GraphStep } from "@kousa/db/schema/graph-runs";
import type { CanvasNode } from "@kousa/projects/canvas";
import { nodeGenerationKind } from "@kousa/projects/canvas";
import { z } from "zod";
import { imageSizes } from "./contracts";
import { GenerationError } from "./input";
import { defaultVoiceFor, imageQualityFor } from "./model-catalog";

const common = {
	content: z.string().max(20_000),
	modelId: z.string().max(120),
};
const ratio = z.enum(["1:1", "16:9", "9:16", "4:3"]);
export const authoredSettingsSchema = z.discriminatedUnion("kind", [
	z.object({ ...common, kind: z.literal("text") }),
	z.object({
		...common,
		kind: z.literal("image"),
		aspectRatio: ratio,
		imageQuality: z.enum(["low", "medium", "high"]).optional(),
	}),
	z.object({
		...common,
		kind: z.literal("video"),
		aspectRatio: ratio,
		duration: z.number().int().min(1).max(12),
	}),
	z.object({
		...common,
		kind: z.literal("speech"),
		voiceId: z.string(),
		voiceDirection: z.string().max(500),
	}),
]);
export type AuthoredSettings = z.infer<typeof authoredSettingsSchema>;

export function captureSettings(
	node: CanvasNode,
	modelId: string,
): AuthoredSettings {
	return authoredSettingsSchema.parse({
		kind: nodeGenerationKind(node.type),
		content: node.data.content,
		modelId,
		aspectRatio: node.data.aspectRatio,
		duration: node.data.duration,
		voiceId: node.data.voiceId ?? defaultVoiceFor(modelId),
		imageQuality: imageQualityFor(modelId, node.data.imageQuality),
		voiceDirection: node.data.voiceDirection,
	});
}

export function settingsPatch(
	settings: AuthoredSettings,
): Partial<CanvasNode["data"]> {
	return {
		content: settings.content,
		[`${settings.kind}Model`]: settings.modelId,
		...(settings.kind === "image" || settings.kind === "video"
			? { aspectRatio: settings.aspectRatio }
			: {}),
		...(settings.kind === "video" ? { duration: settings.duration } : {}),
		...(settings.kind === "image"
			? { imageQuality: settings.imageQuality }
			: {}),
		...(settings.kind === "speech"
			? { voiceId: settings.voiceId, voiceDirection: settings.voiceDirection }
			: {}),
	};
}

// Old workflow plans retain authored content. Old individual runs only retain the
// assembled provider prompt, which must never be guessed back into authored text.
export function historicalSettings(
	run: GenerationRun,
	plan: GraphStep[] | null,
) {
	const saved = authoredSettingsSchema.safeParse(run.authoredSettings);
	if (saved.success && saved.data.kind === run.kind) return saved.data;
	const step = plan?.find((s) => s.runId === run.id && s.nodeId === run.nodeId);
	if (!step) return null;
	const parsed = authoredSettingsSchema.safeParse({
		...step,
		aspectRatio:
			step.kind === "video"
				? step.aspectRatio
				: Object.entries(imageSizes).find(
						([, size]) => size === step.size,
					)?.[0],
	});
	return parsed.success ? parsed.data : null;
}

export async function selectedRun(
	store: Pick<GenerationStore, "get">,
	projectId: string,
	nodeId: string,
	kind: GenerationRun["kind"],
	runId: string,
	canvasId = projectId,
) {
	const run = await store.get(runId);
	if (
		!run ||
		run.projectId !== projectId ||
		run.canvasId !== canvasId ||
		run.nodeId !== nodeId ||
		run.kind !== kind ||
		run.status !== "succeeded"
	)
		throw new GenerationError(
			"BAD_REQUEST",
			"The selected historical output is unavailable. Choose another output in History.",
		);
	return run;
}

export async function resolveTextOutputs(
	store: Pick<GenerationStore, "get" | "outputs">,
	projectId: string,
	sources: { id: string; runId?: string }[],
	canvasId = projectId,
) {
	const latest = await store.outputs(
		projectId,
		sources.filter((s) => !s.runId).map((s) => s.id),
		"text",
		canvasId,
	);
	const pinned = await Promise.all(
		sources.flatMap((s) =>
			s.runId
				? [selectedRun(store, projectId, s.id, "text", s.runId, canvasId)]
				: [],
		),
	);
	return [...latest, ...pinned];
}
