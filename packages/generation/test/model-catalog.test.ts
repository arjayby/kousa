import { createCanvasNode } from "@kousa/projects/canvas";
import { expect, it } from "vitest";
import { textInputByteLimit } from "../src/contracts";
import { planGraph } from "../src/graph-plan";
import { captureSettings, settingsPatch } from "../src/history";
import {
	buildPrompt,
	generationInputHash,
	imageInputSnapshot,
} from "../src/input";
import {
	defaultVoiceFor,
	imageProfile,
	imageSizeFor,
	modelCatalog,
	modelCreditCost,
	modelSettingsPatch,
	resolveSpeechModel,
	speechProfile,
	validateModelSettings,
	videoProfile,
	voicesFor,
} from "../src/model-catalog";
import {
	playgroundCost,
	playgroundSettings,
} from "../src/playground-contracts";

it("has the Gateway generation catalog and positive credit quotes for every available model", () => {
	expect(new Set(modelCatalog.map((model) => model.id)).size).toBe(339);
	expect(
		Object.fromEntries(
			["text", "image", "video", "speech"].map((kind) => [
				kind,
				modelCatalog.filter((model) => model.kind === kind).length,
			]),
		),
	).toEqual({ text: 257, image: 40, video: 36, speech: 6 });
	for (const model of modelCatalog.filter(
		(model) => !model.unavailableReason,
	)) {
		const credits = modelCreditCost(model.kind, model.id);
		expect(Number.isSafeInteger(credits), model.id).toBe(true);
		expect(credits, model.id).toBeGreaterThan(0);
	}
	for (const model of modelCatalog.filter((model) => model.unavailableReason)) {
		expect(modelCreditCost(model.kind, model.id)).toBe(0);
		expect(validateModelSettings({ kind: model.kind, modelId: model.id })).toBe(
			model.unavailableReason,
		);
	}
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

it("gives every enabled media model valid default settings and a compatible voice", () => {
	for (const model of modelCatalog.filter(
		(m) => !m.unavailableReason && m.kind !== "text",
	)) {
		const patch = modelSettingsPatch(model.kind, model.id, {
			aspectRatio: "16:9",
			duration: 5,
		});
		expect(
			validateModelSettings(
				{
					kind: model.kind,
					modelId: model.id,
					aspectRatio: patch.aspectRatio,
					duration: patch.duration,
					voiceId: patch.voiceId,
					imageQuality: patch.imageQuality,
				},
				model.kind === "video" && videoProfile(model.id).requiresImage,
			),
			model.id,
		).toBeNull();
	}
});

it("separates advertised model inputs from generation workflows that are not implemented", () => {
	expect(
		modelCatalog.find((m) => m.id === "google/gemini-3.8-flash")
			?.inputModalities,
	).toContain("image");
	expect(videoProfile("bytedance/seedance-2.5").operations).toContain(
		"video-editing",
	);
	for (const id of [
		"openai/whisper-1",
		"klingai/kling-v3.0-motion-control",
		"bfl/flux-pro-1.0-fill",
	]) {
		expect(
			modelCatalog.find((m) => m.id === id)?.unavailableReason,
			id,
		).toBeTruthy();
	}
});

it("uses model-specific image dimensions, prompt limits, speech voices and prices", () => {
	expect(imageProfile("bfl/flux-kontext-pro").reference).toBe(true);
	expect(imageSizeFor("recraft/recraft-v3", "16:9")).toBe("1820x1024");
	expect(imageSizeFor("recraft/recraft-v4-pro", "16:9")).toBe("2688x1536");
	expect(imageProfile("openai/gpt-image-1.5").aspectRatios).toEqual(["1:1"]);
	expect(
		playgroundSettings.safeParse({
			kind: "image",
			modelId: "recraft/recraft-v3",
			content: "a".repeat(1001),
			aspectRatio: "1:1",
		}).success,
	).toBe(false);
	expect(defaultVoiceFor("openai/tts-1-hd")).toBe("alloy");
	expect(voicesFor("openai/tts-1").map((v) => v.id)).toContain("nova");
	expect(modelCreditCost("speech", "openai/tts-1-hd")).toBe(4);
	expect(speechProfile("fish-audio/s1").direction).toBe(false);
	expect(speechProfile("fish-audio/s2-pro").direction).toBe(true);
	for (const modelId of ["openai/tts-1", "openai/tts-1-hd", "fish-audio/s1"]) {
		expect(
			validateModelSettings({
				kind: "speech",
				modelId,
				voiceId: defaultVoiceFor(modelId),
				voiceDirection: "Excited",
			}),
		).toContain("does not support voice direction");
	}
});

it("bounds both Canvas and Playground inputs for small-context text alternatives", () => {
	const modelId = "tencent/hy-mt2-lite";
	const content = "a".repeat(textInputByteLimit(modelId) + 1);
	expect(() =>
		buildPrompt({ nodeId: "text", modelId, content, sources: [] }, []),
	).toThrow("input limit");
	expect(
		playgroundSettings.safeParse({ kind: "text", modelId, content }).success,
	).toBe(false);
	expect(textInputByteLimit("amazon/nova-micro")).toBe(12_000);
});
