import * as Y from "yjs";
import {
	type CanvasDocument,
	type CanvasEdge,
	type CanvasNode,
	canvasDocumentSchema,
	canvasEdgeSchema,
	canvasNodeSchema,
	connectionError,
} from "./canvas";

// This schema is independent of Liveblocks and React Flow. Synixir can transport
// the same Yjs v1 binary document without translating nodes or text operations.
export const graphKeys = {
	nodes: "kousa:nodes:v1",
	edges: "kousa:edges:v1",
	meta: "kousa:meta:v1",
};
const textFields = ["label", "content", "voiceDirection"] as const;
const compareId = (a: { id: string }, b: { id: string }) =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function sharedNode(node: CanvasNode) {
	const value = new Y.Map<unknown>();
	value.set("type", node.type);
	value.set("position", { ...node.position });
	for (const field of textFields)
		value.set(field, new Y.Text(node.data[field]));
	value.set("aspectRatio", node.data.aspectRatio);
	value.set("duration", node.data.duration);
	if (node.data.textModel) value.set("textModel", node.data.textModel);
	if (node.data.speechModel) value.set("speechModel", node.data.speechModel);
	if (node.data.voiceId) value.set("voiceId", node.data.voiceId);
	if (node.data.videoModel) value.set("videoModel", node.data.videoModel);
	if (node.data.imageModel) value.set("imageModel", node.data.imageModel);
	if (node.data.imageQuality) value.set("imageQuality", node.data.imageQuality);
	if (node.data.imageSource) value.set("imageSource", node.data.imageSource);
	if (node.data.mediaSource) value.set("mediaSource", node.data.mediaSource);
	if (node.data.imageLayout) value.set("imageLayout", node.data.imageLayout);
	if (node.data.clipSettings) value.set("clipSettings", node.data.clipSettings);
	if (node.data.assetId) value.set("assetId", node.data.assetId);
	if (node.data.selectedRunId)
		value.set("selectedRunId", node.data.selectedRunId);
	return value;
}

export function seedCanvasDocument(document: CanvasDocument): Uint8Array {
	const input = canvasDocumentSchema.parse(document);
	const doc = new Y.Doc();
	doc.transact(() => {
		doc.getMap(graphKeys.meta).set("version", 1);
		for (const node of [...input.nodes].sort(compareId))
			doc.getMap(graphKeys.nodes).set(node.id, sharedNode(node));
		for (const edge of [...input.edges].sort(compareId))
			doc.getMap(graphKeys.edges).set(edge.id, { ...edge });
	});
	const update = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return update;
}

export function readCanvasDocument(doc: Y.Doc) {
	const nodes: CanvasNode[] = [];
	let rejected = 0;
	for (const [id, value] of doc.getMap(graphKeys.nodes)) {
		if (!(value instanceof Y.Map)) {
			rejected++;
			continue;
		}
		const data: Record<string, unknown> = {
			aspectRatio: value.get("aspectRatio"),
			textModel: value.get("textModel"),
			imageModel: value.get("imageModel"),
			imageQuality: value.get("imageQuality"),
			videoModel: value.get("videoModel"),
			speechModel: value.get("speechModel"),
			voiceId: value.get("voiceId"),
			imageSource: value.get("imageSource"),
			assetId: value.get("assetId"),
			selectedRunId: value.get("selectedRunId"),
			mediaSource: value.get("mediaSource"),
			clipSettings: value.get("clipSettings"),
			imageLayout: value.get("imageLayout"),
			duration: value.get("duration"),
		};
		for (const field of textFields) {
			const text = value.get(field);
			data[field] = text instanceof Y.Text ? text.toString() : text;
		}
		const parsed = canvasNodeSchema.safeParse({
			id,
			type: value.get("type"),
			position: value.get("position"),
			data,
		});
		if (parsed.success) nodes.push(parsed.data);
		else rejected++;
	}
	nodes.sort(compareId);
	rejected += Math.max(0, nodes.length - 200);
	nodes.splice(200);
	const candidates: CanvasEdge[] = [];
	for (const [id, value] of doc.getMap(graphKeys.edges)) {
		const parsed = canvasEdgeSchema.safeParse(
			typeof value === "object" && value ? { ...value, id } : null,
		);
		if (parsed.success) candidates.push(parsed.data);
		else rejected++;
	}
	const edges: CanvasEdge[] = [];
	// Every replica projects the same valid DAG, even if offline users created a
	// cycle or competing connections. Retain rejected CRDT entries for undo.
	for (const edge of candidates.sort(compareId)) {
		if (edges.length < 600 && connectionError({ nodes, edges }, edge) === null)
			edges.push(edge);
		else rejected++;
	}
	return { document: { version: 1 as const, nodes, edges }, rejected };
}

// Apply the smallest text splice, so another user's independent typing survives.
export function replaceSharedText(text: Y.Text, next: string) {
	const previous = text.toString();
	if (previous === next) return;
	let start = 0;
	while (
		start < previous.length &&
		start < next.length &&
		previous[start] === next[start]
	)
		start++;
	let end = 0;
	while (
		end < previous.length - start &&
		end < next.length - start &&
		previous[previous.length - 1 - end] === next[next.length - 1 - end]
	)
		end++;
	const remove = previous.length - start - end;
	if (remove) text.delete(start, remove);
	const insert = next.slice(start, next.length - end);
	if (insert) text.insert(start, insert);
}

export function createCanvasDocumentModel(doc: Y.Doc) {
	const nodes = doc.getMap<Y.Map<unknown>>(graphKeys.nodes);
	const edges = doc.getMap<CanvasEdge>(graphKeys.edges);
	const origin = {};
	const history = new Y.UndoManager([nodes, edges], {
		trackedOrigins: new Set([origin]),
		captureTimeout: 500,
	});
	let group: string | undefined;
	return {
		doc,
		history,
		getText(id: string, field: (typeof textFields)[number]) {
			const node = nodes.get(id);
			const value = node instanceof Y.Map ? node.get(field) : null;
			return value instanceof Y.Text ? value : null;
		},
		editText(
			id: string,
			field: (typeof textFields)[number],
			edit: (text: Y.Text) => void,
		) {
			const node = nodes.get(id);
			const value = node instanceof Y.Map ? node.get(field) : null;
			if (!(value instanceof Y.Text)) return;
			const nextGroup = `${id}:${field}`;
			if (group !== nextGroup) history.stopCapturing();
			group = nextGroup;
			doc.transact(() => edit(value), origin);
		},
		read: () => readCanvasDocument(doc),
		end() {
			group = undefined;
			history.stopCapturing();
		},
		apply(before: CanvasDocument, after: CanvasDocument, editGroup?: string) {
			canvasDocumentSchema.parse(after);
			if (!editGroup || editGroup !== group) history.stopCapturing();
			group = editGroup;
			const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
			const nextNodes = new Set(after.nodes.map((node) => node.id));
			doc.transact(() => {
				const deleted = new Set(
					before.nodes
						.filter((node) => !nextNodes.has(node.id))
						.map((node) => node.id),
				);
				for (const id of deleted) nodes.delete(id);
				for (const [id, edge] of edges)
					if (deleted.has(edge.source) || deleted.has(edge.target))
						edges.delete(id);
				for (const node of after.nodes) {
					const previous = oldNodes.get(node.id);
					if (!previous) {
						if (!nodes.has(node.id)) nodes.set(node.id, sharedNode(node));
						continue;
					}
					const value = nodes.get(node.id);
					// A remote deletion wins over a stale local field edit.
					if (!(value instanceof Y.Map)) continue;
					if (
						node.position.x !== previous.position.x ||
						node.position.y !== previous.position.y
					)
						value.set("position", { ...node.position });
					for (const field of textFields) {
						if (node.data[field] === previous.data[field]) continue;
						const text = value.get(field);
						if (text instanceof Y.Text)
							replaceSharedText(text, node.data[field]);
					}
					for (const field of [
						"aspectRatio",
						"duration",
						"textModel",
						"imageModel",
						"imageQuality",
						"videoModel",
						"speechModel",
						"voiceId",
						"imageSource",
						"assetId",
						"mediaSource",
						"clipSettings",
						"imageLayout",
						"selectedRunId",
					] as const)
						if (node.data[field] !== previous.data[field])
							value.set(field, node.data[field]);
				}
				const nextEdges = new Set(after.edges.map((edge) => edge.id));
				for (const edge of before.edges)
					if (!nextEdges.has(edge.id)) edges.delete(edge.id);
				const oldEdges = new Set(before.edges.map((edge) => edge.id));
				for (const edge of after.edges)
					if (
						!oldEdges.has(edge.id) &&
						nodes.has(edge.source) &&
						nodes.has(edge.target)
					)
						edges.set(edge.id, { ...edge });
			}, origin);
			if (!editGroup) history.stopCapturing();
		},
		destroy() {
			history.destroy();
		},
	};
}
