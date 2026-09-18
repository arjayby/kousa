"use client";

import {
	type CanvasConnection,
	type CanvasNode,
	connectionError,
	createCanvasNode,
	type NodeKind,
	nodeKinds,
	nodeLabels,
	removeCanvasElements,
} from "@kousa/projects/canvas";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import { cn } from "@kousa/ui/lib/utils";
import {
	Background,
	BackgroundVariant,
	type Connection,
	type Edge,
	MiniMap,
	type NodeTypes,
	ReactFlow,
	ReactFlowProvider,
	SelectionMode,
	useReactFlow,
	useViewport,
} from "@xyflow/react";
import {
	CheckIcon,
	CircleAlertIcon,
	LayoutTemplateIcon,
	LocateFixedIcon,
	LockKeyholeIcon,
	MousePointer2Icon,
	Redo2Icon,
	Trash2Icon,
	Undo2Icon,
	WorkflowIcon,
	ZoomInIcon,
	ZoomOutIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { SaveTemplate } from "@/components/templates/save-template";
import { ClipContext, ClipMonitor, useCanvasClips } from "./canvas-clips";
import { GenerationContext, useCanvasGeneration } from "./canvas-generation";
import { CanvasMediaProvider } from "./canvas-media";
import { CanvasCursors, CanvasPeople } from "./canvas-presence";
import { WorkflowMonitor } from "./canvas-workflow";
import { MediaLibrary } from "./media-library";
import { MediaNode, nodeDescriptions, nodeIcons } from "./media-node";
import { NodeInspector } from "./node-inspector";
import {
	documentFromGraph,
	type StudioEdge,
	type StudioGraph,
	type StudioNode,
	useCanvas,
} from "./use-canvas";
import { WorkflowLauncher } from "./workflow-launcher";
import "@xyflow/react/dist/style.css";

const nodeTypes: NodeTypes = {
	text: MediaNode,
	image: MediaNode,
	video: MediaNode,
	speech: MediaNode,
};
const edgeOptions = {
	type: "smoothstep",
	style: { strokeWidth: 1.7 },
	interactionWidth: 24,
};
const fitOptions = { padding: 0.22, maxZoom: 1 };

function asConnection(value: Connection | Edge): CanvasConnection | null {
	return value.source &&
		value.target &&
		value.sourceHandle === "output" &&
		value.targetHandle
		? {
				source: value.source,
				target: value.target,
				sourceHandle: "output",
				targetHandle: value.targetHandle,
			}
		: null;
}
function clearSelection(graph: StudioGraph): StudioGraph {
	return {
		nodes: graph.nodes.map((node) => ({ ...node, selected: false })),
		edges: graph.edges.map((edge) => ({ ...edge, selected: false })),
	};
}
function ViewportControls() {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const { zoom } = useViewport();
	return (
		<section
			className="studio-viewport-controls"
			aria-label="Canvas navigation"
		>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom out"
				onClick={() => zoomOut({ duration: 150 })}
			>
				<ZoomOutIcon />
			</Button>
			<output
				className="min-w-10 text-center font-mono text-[11px] text-muted-foreground"
				aria-label="Zoom level"
			>
				{Math.round(zoom * 100)}%
			</output>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom in"
				onClick={() => zoomIn({ duration: 150 })}
			>
				<ZoomInIcon />
			</Button>
			<span className="h-4 border-l" />
			<Button
				variant="ghost"
				size="icon"
				aria-label="Fit all nodes"
				title="Fit all nodes"
				onClick={() => fitView({ ...fitOptions, duration: 200 })}
			>
				<LocateFixedIcon />
			</Button>
		</section>
	);
}

function Editor({
	userId,
	projectId,
	canEdit: allowedToEdit,
}: {
	userId: string;
	projectId: string;
	canEdit: boolean;
}) {
	const persistence = useCanvas(userId, projectId, allowedToEdit);
	const { graph, dispatch, canUndo, canRedo, sync, canEdit, session } =
		persistence;
	const canRun =
		canEdit && sync.connection === "connected" && sync.sync === "synchronized";
	const clips = useCanvasClips(userId, projectId, sync.loaded, canRun);
	const generation = useCanvasGeneration({
		userId,
		projectId,
		graph,
		loaded: sync.loaded,
		canRun,
	});
	const saveError = sync.error ?? sync.backupError;
	const statusLabel = sync.error
		? "Connection needs attention"
		: sync.connection !== "connected"
			? sync.loaded
				? "Reconnecting…"
				: "Connecting…"
			: !sync.loaded
				? "Loading shared canvas…"
				: sync.sync === "synchronized"
					? "All changes saved"
					: "Saving…";

	const flow = useReactFlow<StudioNode, StudioEdge>();
	const root = useRef<HTMLDivElement>(null);
	const viewport = useRef<HTMLDivElement>(null);
	const fitAfterAdd = useRef(false);
	const { resolvedTheme } = useTheme();
	const [message, setMessage] = useState("");
	const selectedNodes = graph.nodes.filter((node) => node.selected);
	const selectedEdges = graph.edges.filter((edge) => edge.selected);
	const selectedNode =
		selectedNodes.length === 1 ? selectedNodes[0] : undefined;
	const selectionCount = selectedNodes.length + selectedEdges.length;

	const addNode = useCallback(
		(kind: NodeKind, data?: Partial<CanvasNode["data"]>) => {
			if (!canEdit) return false;
			if (graph.nodes.length >= 200) {
				setMessage("This draft can hold up to 200 nodes.");
				return false;
			}
			const bounds = viewport.current?.getBoundingClientRect();
			if (!bounds) return false;
			const point = flow.screenToFlowPosition({
				x: bounds.left + bounds.width / 2 - 130,
				y: bounds.top + bounds.height / 2 - 110,
			});
			const anchor = graph.nodes[0]?.position ?? point;
			for (let slot = 0; slot < 400; slot++) {
				point.x = Math.max(
					-99_000,
					Math.min(99_000, anchor.x + (slot % 2) * 380),
				);
				point.y = Math.max(
					-99_000,
					Math.min(99_000, anchor.y + Math.floor(slot / 2) * 380),
				);
				if (
					!graph.nodes.some(
						(node) =>
							Math.abs(node.position.x - point.x) < 310 &&
							Math.abs(node.position.y - point.y) < 350,
					)
				)
					break;
			}
			fitAfterAdd.current = true;
			const node = createCanvasNode(kind, point);
			node.data = { ...node.data, ...data };
			dispatch({
				type: "edit",
				update: (current) => ({
					...clearSelection(current),
					nodes: [
						...clearSelection(current).nodes,
						{ ...node, selected: true },
					],
				}),
			});
			setMessage(`${nodeLabels[kind]} node added.`);
			return true;
		},
		[canEdit, graph.nodes, flow, dispatch],
	);
	useEffect(() => {
		if (!fitAfterAdd.current || graph.nodes.length === 0) return;
		fitAfterAdd.current = false;
		void flow.fitView({ ...fitOptions, duration: 200 });
	}, [graph.nodes.length, flow]);

	const removeSelected = useCallback(() => {
		if (!canEdit || !selectionCount) return;
		const nodeIds = selectedNodes.map((node) => node.id);
		const edgeIds = selectedEdges.map((edge) => edge.id);
		dispatch({
			type: "edit",
			update: (current) =>
				removeCanvasElements(documentFromGraph(current), nodeIds, edgeIds),
		});
		setMessage("Selection deleted. You can undo this change.");
	}, [canEdit, selectionCount, selectedNodes, selectedEdges, dispatch]);
	const duplicate = useCallback(() => {
		if (!canEdit || !selectedNode || graph.nodes.length >= 200) return;
		const node = {
			...selectedNode,
			id: crypto.randomUUID(),
			selected: true,
			position: {
				x: Math.min(99_000, selectedNode.position.x + 48),
				y: Math.min(99_000, selectedNode.position.y + 48),
			},
			data: {
				...selectedNode.data,
				selectedRunId: null,
				label:
					`${selectedNode.data.label || nodeLabels[selectedNode.type ?? "text"]} copy`.slice(
						0,
						80,
					),
			},
		};
		dispatch({
			type: "edit",
			update: (current) => ({
				...clearSelection(current),
				nodes: [...clearSelection(current).nodes, node],
			}),
		});
		setMessage("Node duplicated.");
	}, [canEdit, selectedNode, graph.nodes.length, dispatch]);
	const update = (data: Partial<CanvasNode["data"]>, field: string) => {
		if (!canEdit || !selectedNode) return;
		dispatch({
			type: "edit",
			group: `${selectedNode.id}:${field}`,
			update: (current) => ({
				...current,
				nodes: current.nodes.map((node) =>
					node.id === selectedNode.id
						? { ...node, data: { ...node.data, ...data } }
						: node,
				),
			}),
		});
	};
	const validConnection = useCallback(
		(value: Connection | Edge) => {
			const connection = asConnection(value);
			return (
				canEdit &&
				graph.edges.length < 600 &&
				connection !== null &&
				connectionError(documentFromGraph(graph), connection) === null
			);
		},
		[canEdit, graph],
	);
	const connect = useCallback(
		(value: Connection) => {
			if (!canEdit) return;
			const connection = asConnection(value);
			if (!connection) return;
			const error = connectionError(documentFromGraph(graph), connection);
			if (error) {
				setMessage(error);
				return;
			}
			if (graph.edges.length >= 600) {
				setMessage("This draft can hold up to 600 connections.");
				return;
			}
			const edge = { id: crypto.randomUUID(), ...connection };
			dispatch({
				type: "edit",
				update: (current) => ({ ...current, edges: [...current.edges, edge] }),
			});
			setMessage("Nodes connected.");
		},
		[canEdit, graph, dispatch],
	);

	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (!root.current?.contains(document.activeElement)) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.closest(
					"input, textarea, select, audio, video, [contenteditable=true]",
				) ||
					event.altKey)
			)
				return;
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === "z" &&
				canEdit
			) {
				event.preventDefault();
				dispatch({ type: event.shiftKey ? "redo" : "undo" });
			} else if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === "d" &&
				canEdit
			) {
				event.preventDefault();
				duplicate();
			} else if (
				!event.metaKey &&
				!event.ctrlKey &&
				(event.key === "Delete" || event.key === "Backspace") &&
				canEdit &&
				selectionCount
			) {
				event.preventDefault();
				removeSelected();
			} else if (!event.metaKey && !event.ctrlKey && event.key === "Escape") {
				dispatch({
					type: "nodes",
					changes: selectedNodes.map((node) => ({
						type: "select",
						id: node.id,
						selected: false,
					})),
				});
				dispatch({
					type: "edges",
					changes: selectedEdges.map((edge) => ({
						type: "select",
						id: edge.id,
						selected: false,
					})),
				});
			}
		};
		window.addEventListener("keydown", keydown);
		return () => window.removeEventListener("keydown", keydown);
	}, [
		canEdit,
		dispatch,
		duplicate,
		removeSelected,
		selectionCount,
		selectedNodes,
		selectedEdges,
	]);

	function addStarter() {
		if (!canEdit || graph.nodes.length) return;
		const text = createCanvasNode("text", { x: 0, y: 150 });
		text.data.label = "The idea";
		text.data.content =
			"A quiet coastal town at sunrise. Soft light, pastel houses, and the sound of the sea.";
		const image = createCanvasNode("image", { x: 380, y: 0 });
		image.data.label = "First frame";
		image.data.aspectRatio = "16:9";
		const speech = createCanvasNode("speech", { x: 380, y: 340 });
		speech.data.label = "Narration";
		const video = createCanvasNode("video", { x: 760, y: 150 });
		video.data.label = "The scene";
		const edges: StudioEdge[] = [
			{
				id: crypto.randomUUID(),
				source: text.id,
				target: image.id,
				sourceHandle: "output",
				targetHandle: "prompt",
			},
			{
				id: crypto.randomUUID(),
				source: text.id,
				target: speech.id,
				sourceHandle: "output",
				targetHandle: "script",
			},
			{
				id: crypto.randomUUID(),
				source: image.id,
				target: video.id,
				sourceHandle: "output",
				targetHandle: "image",
			},
			{
				id: crypto.randomUUID(),
				source: speech.id,
				target: video.id,
				sourceHandle: "output",
				targetHandle: "audio",
			},
		];
		fitAfterAdd.current = true;
		dispatch({
			type: "edit",
			update: () => ({ nodes: [text, image, speech, video], edges }),
		});
		setMessage("Starter workflow added. Select a node to make it your own.");
	}

	const content = (
		<div className="studio-editor" ref={root}>
			<div className="studio-toolbar">
				<section
					className="flex flex-wrap items-center gap-1"
					aria-label="Add nodes"
				>
					<span className="mr-2 hidden font-medium text-[10px] text-muted-foreground uppercase tracking-widest sm:block">
						Add node
					</span>
					{nodeKinds.map((kind) => {
						const Icon = nodeIcons[kind];
						return (
							<Button
								key={kind}
								variant="ghost"
								disabled={!canEdit || graph.nodes.length >= 200}
								onClick={() => addNode(kind)}
								title={nodeDescriptions[kind]}
								aria-label={`Add ${kind} node`}
							>
								<Icon data-icon="inline-start" />
								{nodeLabels[kind]}
							</Button>
						);
					})}
				</section>
				<div className="ml-auto flex items-center gap-1">
					{allowedToEdit ? (
						<SaveTemplate
							userId={userId}
							projectId={projectId}
							ready={canRun}
							hasNodes={graph.nodes.length > 0}
						/>
					) : null}
					<MediaLibrary
						canEdit={canEdit}
						atNodeLimit={graph.nodes.length >= 200}
						onUseAsset={(asset) =>
							addNode(
								asset.mimeType === "video/mp4"
									? "video"
									: asset.mimeType === "audio/mpeg"
										? "speech"
										: "image",
								{
									label: asset.name.slice(0, 80),
									assetId: asset.id,
									imageSource: "project",
									mediaSource: "project",
								},
							)
						}
					/>
					<WorkflowLauncher
						workflow={generation.workflow}
						graph={graph}
						canEdit={canEdit}
					/>
					<WorkflowMonitor workflow={generation.workflow} />
					<ClipMonitor />
					{session ? <CanvasPeople session={session} /> : null}
					<Button
						variant="ghost"
						size="icon"
						disabled={!canEdit || !canUndo}
						onClick={() => dispatch({ type: "undo" })}
						aria-label="Undo"
						title="Undo · ⌘/Ctrl Z"
					>
						<Undo2Icon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={!canEdit || !canRedo}
						onClick={() => dispatch({ type: "redo" })}
						aria-label="Redo"
						title="Redo · ⌘/Ctrl Shift Z"
					>
						<Redo2Icon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={!canEdit || !selectionCount}
						onClick={removeSelected}
						aria-label="Delete selection"
						title="Delete selection"
					>
						<Trash2Icon />
					</Button>
				</div>
			</div>
			{persistence.recovery && allowedToEdit ? (
				<Alert>
					<AlertTitle>Browser draft available</AlertTitle>
					<AlertDescription>
						<p>
							You have a draft from before live collaboration. Download it to
							keep a copy of those changes.
						</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									if (persistence.recovery)
										persistence.download(persistence.recovery.document);
								}}
							>
								Download draft
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={persistence.discardRecovery}
							>
								Discard draft
							</Button>
						</div>
					</AlertDescription>
				</Alert>
			) : null}
			{saveError ? (
				<Alert variant="destructive">
					<AlertTitle>Canvas needs attention</AlertTitle>
					<AlertDescription>
						<p>{saveError}</p>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={persistence.retry}>
								Retry connection
							</Button>
							{sync.loaded ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() => persistence.download()}
								>
									Download my changes
								</Button>
							) : null}
						</div>
					</AlertDescription>
				</Alert>
			) : null}
			{persistence.rejected > 0 ? (
				<Alert>
					<AlertTitle>Some connections or nodes need review</AlertTitle>
					<AlertDescription>
						Concurrent changes left {persistence.rejected} item(s) outside this
						canvas's limits or connection rules. They are hidden from the
						workflow; undo the conflicting edit to resolve them.
					</AlertDescription>
				</Alert>
			) : null}

			<div className="studio-workspace">
				<div
					className="studio-viewport"
					ref={viewport}
					onPointerMove={(event) =>
						session?.updatePresence({
							cursor: flow.screenToFlowPosition({
								x: event.clientX,
								y: event.clientY,
							}),
						})
					}
					onPointerLeave={() => session?.updatePresence({ cursor: null })}
				>
					<ReactFlow<StudioNode, StudioEdge>
						nodes={graph.nodes}
						edges={graph.edges}
						nodeTypes={nodeTypes}
						defaultEdgeOptions={edgeOptions}
						onNodesChange={(changes) =>
							dispatch({
								type: "nodes",
								changes: changes.filter(
									(change) =>
										change.type !== "remove" &&
										(canEdit ||
											change.type === "select" ||
											change.type === "dimensions"),
								),
							})
						}
						onEdgesChange={(changes) =>
							dispatch({
								type: "edges",
								changes: changes.filter((change) => change.type === "select"),
							})
						}
						onNodeDragStart={() => {
							if (canEdit) dispatch({ type: "checkpoint" });
						}}
						onNodeDragStop={() => dispatch({ type: "end" })}
						onConnect={connect}
						isValidConnection={validConnection}
						onConnectEnd={(_, state) => {
							if (state.toNode && !state.isValid)
								setMessage(
									"Choose a compatible, unused input. Connections cannot form a loop.",
								);
						}}
						nodesDraggable={canEdit}
						nodesConnectable={canEdit}
						edgesReconnectable={false}
						deleteKeyCode={null}
						selectionOnDrag
						selectionMode={SelectionMode.Partial}
						panOnDrag={[1, 2]}
						panOnScroll
						zoomOnScroll={false}
						minZoom={0.2}
						maxZoom={2}
						fitView
						fitViewOptions={fitOptions}
						onlyRenderVisibleElements
						colorMode={resolvedTheme === "dark" ? "dark" : "light"}
						nodeExtent={[
							[-100_000, -100_000],
							[100_000, 100_000],
						]}
						aria-label="Media workflow canvas"
					>
						<Background
							variant={BackgroundVariant.Dots}
							gap={20}
							size={1}
							color="var(--border)"
						/>
						<ViewportControls />
						{session ? <CanvasCursors session={session} /> : null}
						{graph.nodes.length > 0 ? (
							<MiniMap
								pannable
								zoomable
								position="bottom-right"
								nodeColor="var(--muted-foreground)"
								maskColor="var(--background)"
								className="studio-minimap"
							/>
						) : null}
					</ReactFlow>
					{!sync.loaded ? (
						<div className="studio-empty">
							<p role="status" className="text-muted-foreground text-sm">
								{sync.error
									? "Shared canvas unavailable"
									: "Loading shared canvas…"}
							</p>
						</div>
					) : graph.nodes.length === 0 ? (
						<div className="studio-empty">
							<Empty className="border-0">
								<EmptyHeader>
									<div className="studio-empty-icon">
										<WorkflowIcon className="size-7" aria-hidden="true" />
									</div>
									<EmptyTitle>
										{canEdit ? "Start with an idea" : "No nodes yet"}
									</EmptyTitle>
									<EmptyDescription>
										{canEdit
											? "Turn a thought into a connected workflow. Add your first node to begin."
											: "An owner or editor can add nodes to this project. Their changes will appear here live."}
									</EmptyDescription>
								</EmptyHeader>
								{canEdit ? (
									<div className="flex flex-col items-center gap-3">
										<Button onClick={() => addNode("text")}>
											<nodeIcons.text data-icon="inline-start" />
											Add a text node
										</Button>
										<Button variant="ghost" onClick={addStarter}>
											<LayoutTemplateIcon data-icon="inline-start" />
											Try a starter workflow
										</Button>
									</div>
								) : (
									<LockKeyholeIcon className="size-5 text-muted-foreground" />
								)}
							</Empty>
						</div>
					) : null}
					{selectedEdges.length > 0 && !selectedNodes.length ? (
						<div className="studio-selection-info">
							<span>
								{selectedEdges.length} connection
								{selectedEdges.length === 1 ? "" : "s"} selected
							</span>
							{canEdit ? (
								<Button variant="outline" size="sm" onClick={removeSelected}>
									Disconnect
								</Button>
							) : null}
						</div>
					) : null}
				</div>
				{selectedNode ? (
					<NodeInspector
						node={selectedNode}
						nodes={graph.nodes}
						edges={graph.edges}
						canEdit={canEdit}
						model={persistence.model}
						update={update}
						endEdit={() => dispatch({ type: "end" })}
						remove={removeSelected}
						applyHistory={(before, patch) => {
							let applied = false;
							dispatch({
								type: "edit",
								update: (current) => {
									const node = current.nodes.find(
										(node) => node.id === before.id,
									);
									if (
										!node ||
										node.type !== before.type ||
										JSON.stringify(node.data) !== JSON.stringify(before.data)
									)
										return current;
									applied = true;
									return {
										...current,
										nodes: current.nodes.map((item) =>
											item.id === before.id
												? { ...item, data: { ...item.data, ...patch } }
												: item,
										),
									};
								},
							});
							return applied;
						}}
						duplicate={duplicate}
						disconnect={(id) => {
							if (canEdit)
								dispatch({
									type: "edit",
									update: (current) => ({
										...current,
										edges: current.edges.filter((edge) => edge.id !== id),
									}),
								});
						}}
						close={() =>
							dispatch({
								type: "nodes",
								changes: [
									{ type: "select", id: selectedNode.id, selected: false },
								],
							})
						}
					/>
				) : null}
			</div>
			<footer className="studio-statusbar">
				<div
					className={cn(
						"flex items-center gap-1.5",
						saveError && "text-destructive",
					)}
					role="status"
					title={
						saveError ?? "Changes sync live with everyone in this project."
					}
				>
					{saveError ? (
						<CircleAlertIcon className="size-3" />
					) : (
						<CheckIcon className="size-3" />
					)}
					<span>{statusLabel}</span>
					{!allowedToEdit ? <span>· View only</span> : null}
					<span className="hidden sm:inline">
						· {graph.nodes.length} nodes · {graph.edges.length} connections
					</span>
				</div>
				<p className="sr-only" aria-live="polite">
					{message}
				</p>
				<span className="hidden items-center gap-1.5 md:flex">
					<MousePointer2Icon className="size-3" />
					Drag to select · Scroll to pan · Pinch to zoom
				</span>
			</footer>
		</div>
	);
	return (
		<GenerationContext.Provider value={generation}>
			<CanvasMediaProvider
				userId={userId}
				projectId={projectId}
				loaded={sync.loaded}
			>
				<ClipContext.Provider value={clips}>{content}</ClipContext.Provider>
			</CanvasMediaProvider>
		</GenerationContext.Provider>
	);
}
export default function CanvasEditor(props: {
	userId: string;
	projectId: string;
	canEdit: boolean;
}) {
	return (
		<ReactFlowProvider>
			<Editor {...props} />
		</ReactFlowProvider>
	);
}
