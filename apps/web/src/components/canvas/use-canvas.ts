"use client";

import {
	type CanvasDocument,
	type CanvasEdge,
	type CanvasNode,
	canvasDocumentSchema,
	canvasDraftKey,
	emptyCanvas,
} from "@kousa/projects/canvas";
import {
	applyEdgeChanges,
	applyNodeChanges,
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
} from "@xyflow/react";
import { useEffect, useReducer, useState } from "react";

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
function loadDraft(key: string) {
	try {
		const saved = localStorage.getItem(key);
		return {
			document: saved
				? canvasDocumentSchema.parse(JSON.parse(saved))
				: emptyCanvas(),
			error: null,
		};
	} catch {
		return {
			document: emptyCanvas(),
			error:
				"The saved draft could not be opened. It has been kept in this browser without being overwritten.",
		};
	}
}

export function useCanvas(userId: string, projectId: string, canEdit: boolean) {
	const storageKey = canvasDraftKey(userId, projectId);
	const [loaded] = useState(() => loadDraft(storageKey));
	const [state, dispatch] = useReducer(reducer, {
		graph: loaded.document,
		past: [],
		future: [],
		group: null,
	});
	const [saveError, setSaveError] = useState<string | null>(loaded.error);
	const serialized = JSON.stringify(documentFromGraph(state.graph));
	useEffect(() => {
		if (!canEdit || loaded.error) return;
		try {
			localStorage.setItem(storageKey, serialized);
			setSaveError(null);
		} catch {
			setSaveError(
				"This browser could not save the draft. Keep this tab open to preserve your work.",
			);
		}
	}, [serialized, storageKey, canEdit, loaded.error]);
	return { ...state, dispatch, saveError };
}
