import {
	type CanvasDocument,
	type CanvasEdge,
	createCanvasNode,
	generationNodeKind,
} from "@kousa/projects/canvas";

export const starterKinds = [
	"image",
	"image-edit",
	"speech",
	"video",
	"image-video",
] as const;
export type StarterKind = (typeof starterKinds)[number];
export const starterExamples: Record<
	StarterKind,
	{ title: string; description: string; next: string }
> = {
	image: {
		title: "Text to image",
		description:
			"Use written text as an image prompt, then generate your first image.",
		next: "Edit The idea, then choose Generate image on First frame. You do not need to generate the Text node first.",
	},
	"image-edit": {
		title: "Edit a product photo",
		description:
			"Upload a product photo, then describe a new background, lighting, or composition.",
		next: "Upload a photo on Product photo, then select Product ad, describe your changes, and Generate image.",
	},
	speech: {
		title: "Script to speech",
		description:
			"Read a written script aloud. Speech generation requires an enabled paid provider.",
		next: "Edit The script, choose a voice on Narration, then Generate speech. The written script is used directly.",
	},
	video: {
		title: "Text to video",
		description:
			"Create a silent video from a motion prompt. Video-to-video is not supported by current generators.",
		next: "Edit The idea, then choose Generate video on The scene. Video generation produces a silent clip.",
	},
	"image-video": {
		title: "Image to video",
		description:
			"Generate a starting image, then animate it. Requires image-to-video access in this environment.",
		next: "Generate First frame first, then select The scene and Generate video. The video uses the selected image output.",
	},
};
export type StarterCapabilities = {
	image?: boolean;
	speech?: boolean;
	video?: boolean;
	imageToVideo?: boolean;
};
export function starterUnavailable(
	kind: StarterKind,
	capabilities: StarterCapabilities,
) {
	const required =
		kind === "image-video"
			? [capabilities.image, capabilities.video, capabilities.imageToVideo]
			: [capabilities[kind === "image-edit" ? "image" : kind]];
	if (required.some((value) => value === false))
		return kind === "image-video"
			? "Image-to-video is unavailable here. Try Text to image or Text to video."
			: "This generator is unavailable here. Try another example or upload media.";
	return required.some((value) => value === undefined)
		? "Checking generator availability…"
		: null;
}
export function createCanvasStarter(
	kind: StarterKind,
	origin = { x: 0, y: 0 },
) {
	if (kind === "image-edit") {
		const source = createCanvasNode("image", origin);
		source.data.label = "Product photo";
		source.data.imageSource = "project";
		const output = createCanvasNode("image", {
			x: origin.x + 380,
			y: origin.y,
		});
		output.data.label = "Product ad";
		output.data.content =
			"Place this product on a clean studio surface with soft natural lighting and a warm beige background. Keep the product's shape, colors, and label unchanged. Leave space above for ad copy.";
		return {
			document: {
				version: 1,
				nodes: [source, output],
				edges: [
					{
						id: crypto.randomUUID(),
						source: source.id,
						target: output.id,
						sourceHandle: "output",
						targetHandle: "reference",
					},
				],
			} satisfies CanvasDocument,
			sourceId: source.id,
			steps: [
				{ nodeId: output.id, label: output.data.label, kind: output.type },
			],
			kind,
		};
	}
	const text = createCanvasNode("text", origin);
	text.data.label = kind === "speech" ? "The script" : "The idea";
	text.data.content =
		kind === "speech"
			? "The coast wakes slowly. Golden light reaches the pastel houses, and the first boats head out to sea."
			: "A quiet coastal town at sunrise, pastel houses and soft golden light. Cinematic wide shot.";
	const output = createCanvasNode(
		kind === "image-video" ? "image" : generationNodeKind(kind),
		{
			x: origin.x + 380,
			y: origin.y,
		},
	);
	output.data.label =
		output.type === "image"
			? "First frame"
			: output.type === "audio"
				? "Narration"
				: "The scene";
	output.data.aspectRatio = "16:9";
	if (output.type === "video")
		output.data.content =
			"The camera slowly moves toward the harbor. Gentle waves ripple in the morning light.";
	const nodes = [text, output];
	const connect = (
		source: string,
		target: string,
		targetHandle: string,
	): CanvasEdge => ({
		id: crypto.randomUUID(),
		source,
		target,
		sourceHandle: "output",
		targetHandle,
	});
	const edges = [
		connect(text.id, output.id, kind === "speech" ? "script" : "prompt"),
	];
	const steps = [
		{ nodeId: output.id, label: output.data.label, kind: output.type },
	];
	if (kind === "image-video") {
		const video = createCanvasNode("video", { x: origin.x + 760, y: origin.y });
		video.data.label = "The scene";
		video.data.content =
			"Slowly move the camera toward the harbor. Gentle waves ripple in the morning light.";
		nodes.push(video);
		edges.push(connect(output.id, video.id, "image"));
		steps.push({ nodeId: video.id, label: video.data.label, kind: video.type });
	}
	return {
		document: { version: 1, nodes, edges } satisfies CanvasDocument,
		sourceId: text.id,
		steps,
		kind,
	};
}
