import {
	type CanvasConnection,
	type CanvasDocument,
	type CanvasNode,
	imageOutputAssetId,
	inputPorts,
	nodeGenerationKind,
	nodeLabels,
	sourceOutputKind,
} from "@kousa/projects/canvas";
import {
	defaultImageModel,
	defaultVideoModel,
	imageModels,
	type PublicRun,
	resolveTextModel,
	speechModels,
	textModels,
	videoModels,
} from "./contracts";
import {
	imageProfile,
	resolveSpeechModel,
	textInputModalities,
	videoProfile,
} from "./model-catalog";

export function connectionCapability(
	source: CanvasNode,
	target: CanvasNode,
	handle: string,
) {
	const port = inputPorts[target.type].find((port) => port.id === handle);
	const modelId =
		target.type === "text"
			? resolveTextModel(target.data.textModel)
			: target.type === "image"
				? (target.data.imageModel ?? defaultImageModel)
				: target.type === "audio"
					? resolveSpeechModel(target.data.speechModel)
					: (target.data.videoModel ?? defaultVideoModel);
	const models = {
		text: textModels,
		image: imageModels,
		audio: speechModels,
		video: videoModels,
	}[target.type];
	const model = models.find((model) => model.id === modelId)?.name ?? modelId;
	const result = (
		usage: "text" | "image" | "media" | "composition" | "unsupported",
		description: string,
	) => ({ usage, description, model });
	if (!port?.accepts.includes(source.type))
		return result(
			"unsupported",
			`${nodeLabels[target.type]} ${port?.label ?? handle} accepts ${port?.accepts.map((kind) => nodeLabels[kind]).join(" or ") ?? "no output"}, not ${nodeLabels[source.type]}.${target.type === "audio" ? " Speech generation accepts connected text scripts only." : ""}`,
		);
	if (target.type === "video" && handle === "audio")
		return result(
			"composition",
			"Composition only. Create clip combines this saved audio with the saved video. Generate video does not send audio to the model or regenerate audio.",
		);
	if (!models.some((model) => model.id === modelId))
		return result(
			"unsupported",
			`Choose an available ${nodeLabels[target.type]} model before connecting. ${modelId} is not supported.`,
		);
	if (target.type === "text" && source.type !== "text")
		return textInputModalities(modelId).includes(source.type)
			? result(
					"media",
					`Sends this saved ${source.type} to ${model} with the prompt.`,
				)
			: result(
					"unsupported",
					`${model} does not accept ${source.type} context. Choose a model that supports ${source.type}.`,
				);
	if (
		target.type === "image" &&
		handle === "reference" &&
		!imageProfile(modelId).reference
	)
		return result(
			"unsupported",
			`${model} does not support reference images. Disconnect the reference or choose an image editing model.`,
		);
	if (target.type === "image" && handle === "reference")
		return result(
			"image",
			"Edits this reference image using the destination node's prompt. Describe what to change and what to keep.",
		);
	if (
		target.type === "video" &&
		["lastFrame", "reference", "video", "audioReference"].includes(handle)
	) {
		const profile = videoProfile(modelId);
		const supported =
			handle === "lastFrame"
				? profile.lastFrame
				: handle === "reference"
					? profile.referenceImages
					: handle === "video"
						? profile.referenceVideo
						: profile.referenceAudio;
		return supported
			? result(
					"media",
					handle === "lastFrame"
						? "Ends the generated video at this image. Connect a starting frame too."
						: `Sends this ${source.type} as a generation reference. Describe how to use it in the prompt.`,
				)
			: result(
					"unsupported",
					`${model} does not support ${port.label.toLowerCase()}. Choose a compatible video model.`,
				);
	}
	if (
		target.type === "video" &&
		handle === "image" &&
		!videoProfile(modelId).reference
	)
		return result(
			"unsupported",
			`${model} accepts text only. Choose its image-to-video variant or disconnect the image.`,
		);
	if (target.type === "video" && handle === "image")
		return result(
			"image",
			videoProfile(modelId).referenceOnly
				? "Uses this image as a reference for the video prompt."
				: "Uses this image as the starting frame. The video prompt describes its motion.",
		);
	return result(
		"text",
		target.type === "text"
			? "Uses this text as context before the destination node's task."
			: target.type === "audio"
				? "Reads this text first, followed by the destination node's script."
				: "Adds this text before the destination node's prompt.",
	);
}

// Shared by generation snapshots and connection previews. UI port types alone
// do not describe what the current provider adapter consumes.
export function resolveConnection(
	graph: Pick<CanvasDocument, "nodes">,
	connection: CanvasConnection,
) {
	const source = graph.nodes.find((node) => node.id === connection.source);
	const target = graph.nodes.find((node) => node.id === connection.target);
	if (!source || !target) return null;
	const kind = sourceOutputKind(source.type, connection.sourceHandle);
	const capability = connectionCapability(
		kind ? { ...source, type: kind } : source,
		target,
		connection.targetHandle,
	);
	// Derived video outputs are resolved from the original saved video, then extracted.
	const derived =
		source.type === "video" && connection.sourceHandle !== "output";
	if (derived && capability.usage === "composition")
		return {
			source,
			target,
			...capability,
			usage: "unsupported" as const,
			description:
				"Use Reference audio to send this video audio to generation. Clip soundtrack accepts Audio nodes.",
		};
	return {
		source,
		target,
		...capability,
		...(derived && capability.usage !== "unsupported"
			? {
					usage: "media" as const,
					description: `${connection.sourceHandle === "lastFrame" ? "Extracts the last frame" : "Extracts the audio track"} from the selected saved video. ${capability.description}`,
				}
			: {}),
	};
}

export function connectedOutput(source: CanvasNode, candidate?: PublicRun) {
	const run =
		candidate?.nodeId === source.id &&
		candidate.kind === nodeGenerationKind(source.type) &&
		candidate.status === "succeeded" &&
		(!source.data.selectedRunId || candidate.id === source.data.selectedRunId)
			? candidate
			: undefined;
	const project =
		source.type === "image"
			? !source.data.selectedRunId &&
				(source.data.imageSource ??
					(source.data.assetId ? "project" : "generated")) === "project"
			: source.type !== "text" && source.data.mediaSource === "project";

	// Never preview written text or an old attachment in place of a missing pin.
	const unavailable = !!source.data.selectedRunId && !run;
	const text =
		source.type === "text" && !unavailable
			? (run?.output ?? source.data.content)
			: null;
	const assetId = unavailable
		? null
		: project
			? (source.data.assetId ?? null)
			: source.type === "image"
				? source.data.selectedRunId
					? (run?.assetId ?? null)
					: (imageOutputAssetId(source.data, run?.assetId) ?? null)
				: source.type === "text"
					? null
					: (run?.assetId ?? null);
	const version = project
		? "Project asset"
		: source.data.selectedRunId
			? "Selected historical output"
			: run
				? "Latest successful output"
				: source.type === "text"
					? "Written text"
					: assetId
						? "Attached image fallback"
						: "No saved output";
	return {
		version,
		text,
		assetId,
		runId: source.data.selectedRunId ?? (!project ? run?.id : null),
		createdAt: !project ? run?.createdAt : undefined,
		error: unavailable
			? "The selected historical output is unavailable. Choose another output in History."
			: source.type !== "text" && !assetId
				? `Upload or generate ${source.type === "audio" ? "audio" : source.type === "image" ? "an image" : "a video"} on this node first.`
				: null,
	};
}
