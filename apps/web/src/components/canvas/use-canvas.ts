"use client";

import {
	type CanvasDocument,
	type CanvasEdge,
	type CanvasNode,
	canvasDocumentSchema,
	canvasDraftKey,
} from "@kousa/projects/canvas";
import {
	createCanvasSync,
	type SavedCanvas,
} from "@kousa/projects/canvas-sync";
import {
	applyEdgeChanges,
	applyNodeChanges,
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
} from "@xyflow/react";
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { client } from "@/utils/orpc";

export type StudioNode = Node<CanvasNode["data"], CanvasNode["type"]>;
export type StudioEdge = Edge & CanvasEdge;
export type StudioGraph = { nodes: StudioNode[]; edges: StudioEdge[] };
type State = {
	graph: StudioGraph;
	past: CanvasDocument[];
	future: CanvasDocument[];
	group: string | null;
};
type Action =
	| {
			type: "edit";
			update: (graph: StudioGraph) => StudioGraph;
			group?: string;
	  }
	| { type: "nodes"; changes: NodeChange<StudioNode>[] }
	| { type: "edges"; changes: EdgeChange<StudioEdge>[] }
	| { type: "replace"; document: CanvasDocument }
	| { type: "checkpoint" }
	| { type: "end" }
	| { type: "undo" | "redo" };

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
function remember(state: State) {
	return [...state.past.slice(-49), documentFromGraph(state.graph)];
}
function reducer(state: State, action: Action): State {
	switch (action.type) {
		case "replace":
			return { graph: action.document, past: [], future: [], group: null };
		case "edit": {
			const graph = action.update(state.graph);
			if (graph === state.graph) return state;
			return {
				graph,
				past:
					action.group && action.group === state.group
						? state.past
						: remember(state),
				future: [],
				group: action.group ?? null,
			};
		}
		case "nodes": {
			const keyboardMove = action.changes.some(
				(change) =>
					change.type === "position" &&
					change.position &&
					change.dragging === undefined,
			);
			return {
				...state,
				graph: {
					...state.graph,
					nodes: applyNodeChanges(action.changes, state.graph.nodes),
				},
				...(keyboardMove
					? { past: remember(state), future: [], group: null }
					: {}),
			};
		}
		case "edges":
			return {
				...state,
				graph: {
					...state.graph,
					edges: applyEdgeChanges(action.changes, state.graph.edges),
				},
			};
		case "checkpoint":
			return { ...state, past: remember(state), future: [], group: null };
		case "end":
			return { ...state, group: null };
		case "undo": {
			const previous = state.past.at(-1);
			return previous
				? {
						graph: previous,
						past: state.past.slice(0, -1),
						future: [documentFromGraph(state.graph), ...state.future],
						group: null,
					}
				: state;
		}
		case "redo": {
			const next = state.future[0];
			return next
				? {
						graph: next,
						past: remember(state),
						future: state.future.slice(1),
						group: null,
					}
				: state;
		}
	}
}
export function useCanvas(
	userId: string,
	projectId: string,
	canEdit: boolean,
	remote: SavedCanvas,
) {
	const draftKey = canvasDraftKey(userId, projectId);
	const backupKey = `${draftKey}:recovery`;
	const [state, dispatch] = useReducer(reducer, {
		graph: remote.document,
		past: [],
		future: [],
		group: null,
	});
	const [controller] = useState(() =>
		createCanvasSync({
			initial: remote,
			canEdit,
			save: (document, expectedRevision) =>
				client.projects.saveCanvas({ projectId, document, expectedRevision }),
			replace: (document) => dispatch({ type: "replace", document }),
		}),
	);
	const sync = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	const [backupError, setBackupError] = useState<string | null>(null);
	const [recovery, setRecovery] = useState(() => {
		try {
			const backup = localStorage.getItem(backupKey);
			if (backup) {
				const value = JSON.parse(backup);
				const parsed = canvasDocumentSchema.safeParse(value.document);
				if (
					parsed.success &&
					JSON.stringify(parsed.data) !== JSON.stringify(remote.document)
				)
					return {
						document: parsed.data,
						revision: Number.isInteger(value.revision) ? value.revision : -1,
						key: backupKey,
					};
			}
			const legacy = localStorage.getItem(draftKey);
			if (legacy) {
				const parsed = canvasDocumentSchema.safeParse(JSON.parse(legacy));
				if (
					parsed.success &&
					parsed.data.nodes.length &&
					JSON.stringify(parsed.data) !== JSON.stringify(remote.document)
				)
					return { document: parsed.data, revision: 0, key: draftKey };
			}
		} catch {
			/* Leave unreadable drafts untouched. The server canvas still opens. */
		}
		return null;
	});
	const [reloadError, setReloadError] = useState<string | null>(null);
	const [reloading, setReloading] = useState(false);
	const serialized = JSON.stringify(documentFromGraph(state.graph));
	useEffect(() => {
		controller.setActive(true);
		return () => controller.setActive(false);
	}, [controller]);
	useEffect(() => controller.setCanEdit(canEdit), [controller, canEdit]);
	useEffect(
		() => controller.edit(JSON.parse(serialized)),
		[controller, serialized],
	);
	useEffect(() => controller.receive(remote), [controller, remote]);
	useEffect(() => {
		if (!canEdit) return;
		try {
			if (sync.dirty)
				localStorage.setItem(
					backupKey,
					JSON.stringify({
						revision: sync.revision,
						document: JSON.parse(serialized),
					}),
				);
			else if (sync.status === "saved") {
				const backup = localStorage.getItem(backupKey);
				if (
					backup &&
					JSON.stringify(JSON.parse(backup).document) === serialized
				)
					localStorage.removeItem(backupKey);
			}
			setBackupError(null);
		} catch {
			setBackupError(
				"A recovery copy could not be saved in this browser. Keep this tab open until the project is saved.",
			);
		}
	}, [backupKey, canEdit, serialized, sync.dirty, sync.revision, sync.status]);
	useEffect(() => {
		if (!sync.dirty) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [sync.dirty]);
	function download(document: CanvasDocument = documentFromGraph(state.graph)) {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(document, null, 2)], {
				type: "application/json",
			}),
		);
		const anchor = window.document.createElement("a");
		anchor.href = url;
		anchor.download = `kousa-${projectId}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}
	async function reload() {
		setReloading(true);
		setReloadError(null);
		try {
			const [latest, project] = await Promise.all([
				client.projects.getCanvas({ projectId }),
				client.projects.get({ projectId }),
			]);
			controller.setCanEdit(project.permissions.canEdit);
			controller.reset(latest);
		} catch {
			setReloadError(
				"The saved canvas could not be loaded. Your current changes are still here.",
			);
		} finally {
			setReloading(false);
		}
	}
	return {
		...state,
		dispatch,
		sync,
		backupError,
		reloadError,
		reloading,
		reload,
		download,
		canEdit:
			canEdit &&
			sync.canEdit &&
			!reloading &&
			sync.status !== "forbidden" &&
			sync.status !== "conflict",
		save: controller.flush,
		retry: controller.retry,
		recovery,
		discardRecovery: () => {
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
				setBackupError("The browser draft could not be removed.");
			}
		},
		restoreRecovery: () => {
			if (
				!canEdit ||
				!recovery ||
				recovery.revision !== sync.revision ||
				sync.dirty
			)
				return;
			dispatch({ type: "edit", update: () => recovery.document });
			setRecovery(null);
		},
	};
}
