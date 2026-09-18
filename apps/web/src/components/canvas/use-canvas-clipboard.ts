"use client";

import {
	type CanvasClipboard,
	copyCanvasSelection,
	parseCanvasClipboard,
	pasteCanvasSelection,
} from "@kousa/projects/canvas-clipboard";
import { createCanvasClipboardAccess } from "@kousa/projects/canvas-clipboard-access";
import { useReactFlow } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
	documentFromGraph,
	type StudioEdge,
	type StudioGraph,
	type StudioNode,
	type useCanvas,
} from "./use-canvas";

// Browser memory only, shared across client-side project navigation. Each saved
// selection is scoped to its account and never persisted to browser storage.
const clipboardAccess = createCanvasClipboardAccess();

export function isCanvasTextTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		Boolean(
			target.closest(
				'input, textarea, select, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
			),
		)
	);
}

export function useCanvasClipboard({
	userId,
	projectId,
	graph,
	canEdit,
	root,
	viewport,
	dispatch,
	notify: announce,
	fitAfterAdd,
}: {
	userId: string;
	projectId: string;
	graph: StudioGraph;
	canEdit: boolean;
	root: RefObject<HTMLDivElement | null>;
	viewport: RefObject<HTMLDivElement | null>;
	dispatch: ReturnType<typeof useCanvas>["dispatch"];
	notify: (message: string) => void;
	fitAfterAdd: RefObject<boolean>;
}) {
	const flow = useReactFlow<StudioNode, StudioEdge>();
	const notify = useCallback(
		(message: string) => {
			announce(message);
			toast(message, { id: "canvas-clipboard" });
		},
		[announce],
	);
	const lifetime = useRef<{ userId: string; projectId: string } | null>(null);
	const lastPaste = useRef({ text: "", count: 0 });
	useEffect(() => {
		lifetime.current = { userId, projectId };
		lastPaste.current = { text: "", count: 0 };
		return () => {
			lifetime.current = null;
		};
	}, [userId, projectId]);
	const selection = useCallback(() => {
		const ids = graph.nodes
			.filter((node) => node.selected)
			.map((node) => node.id);
		return ids.length
			? copyCanvasSelection(documentFromGraph(graph), ids, projectId)
			: null;
	}, [graph, projectId]);
	const insert = useCallback(
		(
			clipboard: CanvasClipboard,
			action: "duplicate" | "paste" | "paste-local",
			offset = 0,
		) => {
			const duplicate = action === "duplicate";
			if (!canEdit) return;
			const bounds = viewport.current?.getBoundingClientRect();
			const anchor =
				!duplicate && bounds
					? flow.screenToFlowPosition({
							x: bounds.left + bounds.width / 2 - 130,
							y: bounds.top + bounds.height / 2 - 110,
						})
					: undefined;
			if (anchor) {
				anchor.x += offset;
				anchor.y += offset;
			}
			let added = 0;
			try {
				dispatch({
					type: "edit",
					update: (current) => {
						const copy = pasteCanvasSelection(
							clipboard,
							documentFromGraph(current),
							projectId,
							anchor,
						);
						added = copy.nodes.length;
						fitAfterAdd.current = true;
						return {
							nodes: [
								...current.nodes.map((node) => ({ ...node, selected: false })),
								...copy.nodes.map((node) => ({ ...node, selected: true })),
							],
							edges: [
								...current.edges.map((edge) => ({ ...edge, selected: false })),
								...copy.edges.map((edge) => ({ ...edge, selected: true })),
							],
						};
					},
				});
				if (added)
					notify(
						`${added} node${added === 1 ? "" : "s"} ${duplicate ? "duplicated" : action === "paste-local" ? "pasted from your last canvas copy" : "pasted"}. Internal connections included. ${clipboard.projectId !== projectId ? "Project media cleared. " : ""}Generation history stays on the originals.`,
					);
			} catch (error) {
				notify(
					error instanceof Error
						? error.message
						: "Could not paste this selection.",
				);
			}
		},
		[canEdit, viewport, flow, dispatch, projectId, fitAfterAdd, notify],
	);
	const duplicate = useCallback(() => {
		const clipboard = selection();
		if (clipboard) insert(clipboard, "duplicate");
	}, [selection, insert]);
	const copy = useCallback(async () => {
		const clipboard = selection();
		if (!clipboard) return;
		const request = lifetime.current;
		const source = await clipboardAccess.copy(
			userId,
			JSON.stringify(clipboard),
			(text) => navigator.clipboard.writeText(text),
		);
		if (request === lifetime.current)
			notify(
				source === "canvas"
					? "Selection copied in Kousa. Use the Paste nodes button to insert it."
					: "Selection copied with its internal connections.",
			);
	}, [userId, selection, notify]);
	const pasteText = useCallback(
		(text: string, source: "system" | "canvas" = "system") => {
			const clipboard = parseCanvasClipboard(text);
			if (!clipboard) {
				notify("Copy nodes from a Kousa canvas before pasting here.");
				return;
			}
			const count =
				lastPaste.current.text === text ? lastPaste.current.count + 1 : 0;
			lastPaste.current = { text, count };
			insert(
				clipboard,
				source === "canvas" ? "paste-local" : "paste",
				count * 48,
			);
		},
		[insert, notify],
	);
	const paste = useCallback(async () => {
		if (!canEdit) return;
		const request = lifetime.current;
		try {
			const { text, source } = await clipboardAccess.read(userId, () =>
				navigator.clipboard.readText(),
			);
			if (request === lifetime.current) pasteText(text, source);
		} catch {
			if (request === lifetime.current)
				notify(
					"Copy a selection in Kousa first, or press ⌘/Ctrl+V to paste from another app.",
				);
		}
	}, [userId, canEdit, pasteText, notify]);
	useEffect(() => {
		const focused = (event: ClipboardEvent) =>
			root.current?.contains(document.activeElement) &&
			!isCanvasTextTarget(event.target);
		const onCopy = (event: ClipboardEvent) => {
			// Native text copying replaces the system clipboard too. Do not later
			// fall back to an older node selection after a known copy or cut.
			clipboardAccess.forget(userId);
			if (
				!focused(event) ||
				window.getSelection()?.toString() ||
				!event.clipboardData
			)
				return;
			const clipboard = selection();
			if (!clipboard) return;
			const text = JSON.stringify(clipboard);
			event.clipboardData.setData("text/plain", text);
			clipboardAccess.remember(userId, text);
			event.preventDefault();
			notify("Selection copied with its internal connections.");
		};
		const onPaste = (event: ClipboardEvent) => {
			if (!focused(event) || !canEdit || !event.clipboardData) return;
			event.preventDefault();
			const text = event.clipboardData.getData("text/plain");
			clipboardAccess.remember(userId, text);
			pasteText(text);
		};
		const onCut = () => clipboardAccess.forget(userId);
		window.addEventListener("copy", onCopy);
		window.addEventListener("paste", onPaste);
		window.addEventListener("cut", onCut);
		return () => {
			window.removeEventListener("copy", onCopy);
			window.removeEventListener("paste", onPaste);
			window.removeEventListener("cut", onCut);
		};
	}, [userId, root, selection, canEdit, pasteText, notify]);
	return { copy, paste, duplicate };
}
