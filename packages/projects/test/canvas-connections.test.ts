import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type CanvasEdge, createCanvasNode, emptyCanvas } from "../src/canvas";
import {
	connectionDependencies,
	planConnection,
} from "../src/canvas-connections";
import {
	createCanvasDocumentModel,
	seedCanvasDocument,
} from "../src/canvas-document";

const node = () => createCanvasNode("text", { x: 0, y: 0 });
const edge = (source: string, target: string): CanvasEdge => ({
	id: crypto.randomUUID(),
	source,
	target,
	sourceHandle: "output",
	targetHandle: "context",
});

describe("connection edits", () => {
	it("reconnects into multi-input context without replacing the other connection, including on a remote replica", () => {
		const a = node();
		const b = node();
		const c = node();
		const d = node();
		const nodes = [a, b, c, d];
		const original = edge(a.id, b.id);
		const occupied = edge(c.id, d.id);
		const graph = { ...emptyCanvas(), nodes, edges: [original, occupied] };
		const doc = new Y.Doc();
		const remote = new Y.Doc();
		Y.applyUpdate(doc, seedCanvasDocument(graph));
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
		const model = createCanvasDocumentModel(doc);
		const replica = createCanvasDocumentModel(remote);
		const connection = edge(a.id, d.id);
		const plan = planConnection(graph, connection, original.id);
		expect(plan.error).toBeNull();
		expect(plan.removed).toHaveLength(1);
		model.apply(graph, { ...graph, edges: [...plan.edges, connection] });
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
		expect(
			new Set(replica.read().document.edges.map((edge) => edge.id)),
		).toEqual(new Set([occupied.id, connection.id]));
		model.history.undo();
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
		expect(
			new Set(replica.read().document.edges.map((edge) => edge.id)),
		).toEqual(new Set([original.id, occupied.id]));
		expect(model.history.canUndo()).toBe(false);
		model.history.redo();
		expect(new Set(model.read().document.edges.map((edge) => edge.id))).toEqual(
			new Set([occupied.id, connection.id]),
		);
		model.destroy();
		replica.destroy();
		doc.destroy();
		remote.destroy();
	});
	it("adds context without replacing existing inputs", () => {
		const a = node();
		const b = node();
		const c = node();
		const old = edge(a.id, b.id);
		const graph = { nodes: [a, b, c], edges: [old] };
		const plan = planConnection(graph, edge(c.id, b.id));
		expect(plan.error).toBeNull();
		expect(plan.occupied).toBeUndefined();
		expect(plan.edges).toEqual([old]);
		expect(graph.edges).toEqual([old]);
	});
	it("validates loops against the final graph and preserves the original on rejection", () => {
		const a = node();
		const b = node();
		const c = node();
		const first = edge(a.id, b.id);
		const second = edge(b.id, c.id);
		const graph = { nodes: [a, b, c], edges: [first, second] };
		expect(planConnection(graph, edge(c.id, b.id)).error).toContain("loop");
		expect(graph.edges).toEqual([first, second]);
		// Moving the second edge removes the old b → c path before validating c → b.
		expect(planConnection(graph, edge(c.id, b.id), second.id).error).toBeNull();
		expect(
			planConnection(graph, edge(a.id, c.id), crypto.randomUUID()).error,
		).toContain("removed");
	});
	it("reports missing ports and specific incompatible types", () => {
		const a = node();
		const b = createCanvasNode("image", { x: 0, y: 0 });
		const graph = { nodes: [a, b], edges: [] };
		expect(
			planConnection(graph, { ...edge(a.id, b.id), targetHandle: "reference" })
				.error,
		).toContain("accepts Image");
		expect(planConnection(graph, edge(a.id, b.id)).error).toContain(
			"no context input",
		);
	});
	it("follows every upstream and downstream branch without including unrelated nodes", () => {
		const a = node();
		const b = node();
		const c = node();
		const d = node();
		const unrelated = node();
		const edges = [edge(a.id, b.id), edge(b.id, c.id), edge(b.id, d.id)];
		const result = connectionDependencies(
			{ nodes: [a, b, c, d, unrelated], edges },
			[b.id],
		);
		expect(result.upstream.nodes).toEqual(new Set([a.id]));
		expect(result.downstream.nodes).toEqual(new Set([c.id, d.id]));
		expect(result.upstream.edges).toEqual(new Set([edges[0]?.id]));
	});
});
