import { type CanvasDocument, canvasDocumentSchema } from "./canvas";
import { templateImageLayout } from "./image-layout";

// Explicitly copy authoring fields. Assets, generated output and future runtime
// fields must never leak into another project through a template.
export function copyTemplateDocument(raw: unknown): CanvasDocument {
	const source = canvasDocumentSchema.parse(raw);
	const ids = new Map(
		source.nodes.map((node) => [node.id, crypto.randomUUID()]),
	);
	const nodeId = (id: string) => {
		const copy = ids.get(id);
		if (!copy)
			throw new Error("Template connection references a missing node.");
		return copy;
	};
	return {
		version: 1,
		nodes: source.nodes.map((node) => ({
			id: nodeId(node.id),
			type: node.type,
			position: { ...node.position },
			data: {
				label: node.data.label,
				imageLayout: node.data.imageLayout
					? templateImageLayout(node.data.imageLayout)
					: undefined,
				content: node.data.content,
				aspectRatio: node.data.aspectRatio,
				duration: node.data.duration,
				voiceDirection: node.data.voiceDirection,
				textModel: node.data.textModel,
				imageModel: node.data.imageModel,
				videoModel: node.data.videoModel,
				speechModel: node.data.speechModel,
				voiceId: node.data.voiceId,
				clipSettings: node.data.clipSettings
					? { ...node.data.clipSettings }
					: undefined,
				...(node.type === "image" ? { imageSource: "generated" as const } : {}),
				...(node.type === "video" || node.type === "audio"
					? { mediaSource: "generated" as const }
					: {}),
			},
		})),
		edges: source.edges.map((edge) => ({
			id: crypto.randomUUID(),
			source: nodeId(edge.source),
			target: nodeId(edge.target),
			sourceHandle: edge.sourceHandle,
			targetHandle: edge.targetHandle,
		})),
	};
}
