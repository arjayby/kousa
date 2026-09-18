"use client";

import {
	type CanvasDocument,
	type CanvasEdge,
	type CanvasNode,
	canvasDocumentSchema,
	canvasDraftKey,
	emptyCanvas,
} from "@kousa/projects/canvas";
import { createCanvasDocumentModel } from "@kousa/projects/canvas-document";
import {
	applyEdgeChanges,
	applyNodeChanges,
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
} from "@xyflow/react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type {
	CanvasSession,
	CollaborationState,
} from "./collaboration-session";
import { createLiveblocksSession } from "./liveblocks-session";

export type StudioNode = Node<CanvasNode["data"], CanvasNode["type"]>;
export type StudioEdge = Edge & CanvasEdge;
export type StudioGraph = { nodes: StudioNode[]; edges: StudioEdge[] };
type Action =
	| {
			type: "edit";
			update: (graph: StudioGraph) => StudioGraph;
			group?: string;
	  }
	| { type: "nodes"; changes: NodeChange<StudioNode>[] }
	| { type: "edges"; changes: EdgeChange<StudioEdge>[] }
	| { type: "checkpoint" | "end" | "undo" | "redo" };
const initialSync: CollaborationState = {
	connection: "connecting",
	loaded: false,
	canWrite: false,
	sync: "loading",
	error: null,
	backupError: null,
};
const noopSubscribe = () => () => {};
const initialSnapshot = () => initialSync;
export function documentFromGraph(graph: StudioGraph): CanvasDocument {
	return {
		version: 1,
		nodes: graph.nodes.map(({ id, type, position, data }) => ({
			id,
			type: type ?? "text",
			position,
			data,
		})),
		edges: graph.edges.map(
			({ id, source, target, sourceHandle, targetHandle }) => ({
				id,
				source,
				target,
				sourceHandle,
				targetHandle,
			}),
		),
	};
}
type Instance = {
	session: CanvasSession;
	model: ReturnType<typeof createCanvasDocumentModel>;
};
export function useCanvas(
	userId: string,
	projectId: string,
	canvasId: string,
	allowedToEdit: boolean,
) {
	const [instance, setInstance] = useState<Instance | null>(null);
	const instanceRef = useRef<Instance | null>(null);
	const graphRef = useRef<StudioGraph>(emptyCanvas());
	const [graph, setGraph] = useState<StudioGraph>(graphRef.current);
	const [history, setHistory] = useState({ canUndo: false, canRedo: false });
	const [rejected, setRejected] = useState(0);
	const dragGroup = useRef<string | undefined>(undefined);
	const permissionRef = useRef(allowedToEdit);
	permissionRef.current = allowedToEdit;
	const sync = useSyncExternalStore(
		instance?.session.subscribe ?? noopSubscribe,
		instance?.session.getSnapshot ?? initialSnapshot,
		initialSnapshot,
	);
	const canEdit = allowedToEdit && sync.loaded && sync.canWrite && !sync.error;
	const assign = useCallback((next: StudioGraph) => {
		graphRef.current = next;
		setGraph(next);
	}, []);
	useEffect(() => {
		const session = createLiveblocksSession(userId, projectId, canvasId);
		const model = createCanvasDocumentModel(session.doc);
		const current = { session, model };
		instanceRef.current = current;
		setInstance(current);
		function refresh() {
			const { document, rejected } = model.read();
			const previousNodes = new Map(
				graphRef.current.nodes.map((node) => [node.id, node]),
			);
			const previousEdges = new Map(
				graphRef.current.edges.map((edge) => [edge.id, edge]),
			);
			assign({
				nodes: document.nodes.map((node) => {
					const old = previousNodes.get(node.id);
					if (
						old &&
						old.type === node.type &&
						old.position.x === node.position.x &&
						old.position.y === node.position.y &&
						JSON.stringify(old.data) === JSON.stringify(node.data)
					)
						return old;
					return { ...old, ...node };
				}),
				edges: document.edges.map((edge) => ({
					...previousEdges.get(edge.id),
					...edge,
				})),
			});
			setRejected(rejected);
		}
		function historyChanged() {
			setHistory({
				canUndo: model.history.canUndo(),
				canRedo: model.history.canRedo(),
			});
		}
		session.doc.on("afterTransaction", refresh);
		model.history.on("stack-item-added", historyChanged);
		model.history.on("stack-item-popped", historyChanged);
		model.history.on("stack-cleared", historyChanged);
		refresh();
		historyChanged();
		return () => {
			session.doc.off("afterTransaction", refresh);
			model.destroy();
			session.destroy();
			if (instanceRef.current === current) instanceRef.current = null;
		};
	}, [userId, projectId, canvasId, assign]);
	const dispatch = useCallback(
		(action: Action) => {
			const current = instanceRef.current;
			if (!current) return;
			const { session, model } = current;
			const state = session.getSnapshot();
			const editable =
				permissionRef.current && state.canWrite && state.loaded && !state.error;
			if (action.type === "end") {
				model.end();
				dragGroup.current = undefined;
				return;
			}
			if (action.type === "checkpoint") {
				model.end();
				dragGroup.current = "drag";
				return;
			}
			if (action.type === "undo" || action.type === "redo") {
				if (editable) {
					model.end();
					model.history[action.type]();
				}
				return;
			}
			const previous = graphRef.current;
			let next = previous;
			if (action.type === "nodes")
				next = {
					...previous,
					nodes: applyNodeChanges(
						action.changes.filter(
							(change) =>
								editable ||
								change.type === "select" ||
								change.type === "dimensions",
						),
						previous.nodes,
					),
				};
			if (action.type === "edges")
				next = {
					...previous,
					edges: applyEdgeChanges(
						action.changes.filter((change) => change.type === "select"),
						previous.edges,
					),
				};
			if (action.type === "edit" && editable) next = action.update(previous);
			assign(next);
			if (editable) {
				const before = documentFromGraph(previous);
				const after = documentFromGraph(next);
				if (JSON.stringify(before) !== JSON.stringify(after))
					model.apply(
						before,
						after,
						action.type === "edit" ? action.group : dragGroup.current,
					);
			}
			session.updatePresence({
				selection: next.nodes
					.filter((node) => node.selected)
					.map((node) => node.id),
			});
		},
		[assign],
	);
	const [recovery, setRecovery] = useState<{
		document: CanvasDocument;
		key: string;
	} | null>(null);
	useEffect(() => {
		const key = canvasDraftKey(userId, canvasId);
		for (const candidate of [`${key}:recovery`, key]) {
			try {
				const raw = localStorage.getItem(candidate);
				if (!raw) continue;
				const value = JSON.parse(raw);
				const parsed = canvasDocumentSchema.safeParse(value.document ?? value);
				if (parsed.success && parsed.data.nodes.length) {
					setRecovery({ document: parsed.data, key: candidate });
					break;
				}
			} catch {
				/* Preserve unreadable legacy drafts without merging them. */
			}
		}
	}, [userId, canvasId]);
	function download(
		document: CanvasDocument = documentFromGraph(graphRef.current),
	) {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(document, null, 2)], {
				type: "application/json",
			}),
		);
		const anchor = window.document.createElement("a");
		anchor.href = url;
		anchor.download = `kousa-${canvasId}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}
	return {
		graph,
		dispatch,
		...history,
		sync,
		canEdit,
		session: instance?.session ?? null,
		model: instance?.model ?? null,
		rejected,
		recovery,
		download,
		retry: () => instanceRef.current?.session.reconnect(),
		discardRecovery() {
			if (!recovery) return;
			try {
				const raw = localStorage.getItem(recovery.key);
				if (raw) {
					const value = JSON.parse(raw);
					if (
						JSON.stringify(value.document ?? value) ===
						JSON.stringify(recovery.document)
					)
						localStorage.removeItem(recovery.key);
				}
				setRecovery(null);
			} catch {
				/* Keep draft visible if browser storage is unavailable. */
			}
		},
	};
}
