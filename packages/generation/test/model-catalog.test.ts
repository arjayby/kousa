import { createCanvasNode } from "@kousa/projects/canvas";
import { expect, it } from "vitest";
import { planGraph } from "../src/graph-plan";
import { captureSettings, settingsPatch } from "../src/history";
import { generationInputHash, imageInputSnapshot } from "../src/input";
import {
	defaultVoiceFor,
	imageSizeFor,
	modelCatalog,
	modelCreditCost,
	modelSettingsPatch,
	resolveSpeechModel,
	validateModelSettings,
} from "../src/model-catalog";
import {
	playgroundCost,
	playgroundSettings,
} from "../src/playground-contracts";

it("has only the reviewed catalog and positive credit quotes for every available model", () => {
	expect(new Set(modelCatalog.map((model) => model.id)).size).toBe(65);
	expect(
		Object.fromEntries(
			["text", "image", "video", "speech"].map((kind) => [
				kind,
				modelCatalog.filter((model) => model.kind === kind).length,
			]),
		),
	).toEqual({ text: 24, image: 19, video: 20, speech: 2 });
	for (const model of modelCatalog.filter(
		(model) => !model.unavailableReason,
	)) {
		const credits = modelCreditCost(model.kind, model.id);
		expect(Number.isSafeInteger(credits), model.id).toBe(true);
		expect(credits, model.id).toBeGreaterThan(0);
	}
	expect(
		modelCatalog
			.filter((model) => model.unavailableReason)
			.map((model) => model.id),
	).toEqual(["google/gemini-omni-flash-preview"]);
});

it("resets incompatible video and voice settings when changing models", () => {
	expect(
		modelSettingsPatch("video", "google/veo-3.1-generate-001", {
			aspectRatio: "1:1",
			duration: 5,
		}),
	).toMatchObject({ aspectRatio: "16:9", duration: 4 });
	expect(
		modelSettingsPatch("speech", "spacexai/grok-tts", {
			voiceId: defaultVoiceFor("fish-audio/s2.1-pro"),
			voiceDirection: "Calm",
		}),
	).toEqual({
		speechModel: "spacexai/grok-tts",
		voiceId: "eve",
		voiceDirection: "",
	});
	expect(resolveSpeechModel("fish-audio/s2.1-pro-free")).toBe(
		"fish-audio/s2.1-pro",
	);
	expect(
		validateModelSettings({
			kind: "speech",
			modelId: "spacexai/grok-tts",
			voiceId: "eve",
		}),
	).toBeNull();
	expect(
		validateModelSettings({
			kind: "speech",
			modelId: "spacexai/grok-tts",
			voiceId: "eve",
			voiceDirection: "Calm",
		}),
	).toContain("delivery tags");
});

it("rejects unsupported model, voice, duration, ratio, and reference combinations", () => {
	expect(
		validateModelSettings({ kind: "text", modelId: "unknown/model" }),
	).toBeTruthy();
	expect(
		validateModelSettings({
			kind: "video",
			modelId: "google/gemini-omni-flash-preview",
			duration: 5,
			aspectRatio: "16:9",
		}),
	).toContain("not yet verified");
	expect(
		validateModelSettings({
			kind: "video",
			modelId: "google/veo-3.1-generate-001",
			duration: 5,
			aspectRatio: "16:9",
		}),
	).toContain("duration");
	expect(
		validateModelSettings({
			kind: "video",
			modelId: "klingai/kling-v3.0-i2v",
			duration: 5,
			aspectRatio: "16:9",
		}),
	).toContain("Connect an Image");
	expect(
		validateModelSettings(
			{
				kind: "video",
				modelId: "klingai/kling-v3.0-t2v",
				duration: 5,
				aspectRatio: "16:9",
			},
			true,
		),
	).toContain("text only");
	expect(
		validateModelSettings(
			{ kind: "image", modelId: "recraft/recraft-v4.1", aspectRatio: "1:1" },
			true,
		),
	).toContain("reference images");
	expect(
		validateModelSettings({
			kind: "image",
			modelId: "openai/gpt-image-2",
			aspectRatio: "16:9",
		}),
	).toContain("aspect ratio");
	expect(
		validateModelSettings({
			kind: "speech",
			modelId: "spacexai/grok-tts",
			voiceId: defaultVoiceFor("fish-audio/s2.1-pro"),
		}),
	).toContain("voice");
});

it("carries image quality through history, hashes, workflow estimates and Playground", async () => {
	const node = createCanvasNode("image", { x: 0, y: 0 });
	Object.assign(node.data, {
		content: "A lantern",
		imageModel: "openai/gpt-image-2.5-flare",
		imageQuality: "low",
		aspectRatio: "16:9",
	});
	const graph = { version: 1 as const, nodes: [node], edges: [] };
	const hash = await generationInputHash(graph, node.id);
	expect(imageInputSnapshot(graph, node.id)).toMatchObject({
		size: "1536x864",
		imageQuality: "low",
	});
	node.data.imageQuality = "high";
	expect(await generationInputHash(graph, node.id)).not.toBe(hash);
	const settings = captureSettings(node, "openai/gpt-image-2.5-flare");
	expect(settingsPatch(settings)).toMatchObject({ imageQuality: "high" });
	const { plan } = await planGraph(graph, node.id);
	expect(plan[0]).toMatchObject({
		credits: 80,
		imageQuality: "high",
		authoredSettings: settings,
	});
	expect(playgroundCost(settings)).toBe(80);
	expect(playgroundSettings.safeParse(settings).success).toBe(true);
	expect(imageSizeFor("bytedance/seedream-4.5", "1:1")).toBe("2048x2048");
	expect(imageSizeFor("recraft/recraft-v4.1-pro", "16:9")).toBe("2688x1536");
});
