"use client";

import {
	type ChatProposal,
	insertChatProposal,
} from "@kousa/generation/canvas-chat";
import { resolveConnection } from "@kousa/generation/connections";
import { canonical } from "@kousa/generation/freshness";
import {
	createImageVariations,
	imageVariationSourceKey,
} from "@kousa/generation/image-variations";
import {
	createCanvasStarter,
	type StarterKind,
	starterUnavailable,
} from "@kousa/generation/starters";
import { uploadAccept, uploadFormats } from "@kousa/media/upload";
import {
	type CanvasConnection,
	type CanvasNode,
	createCanvasNode,
	type NodeKind,
	nodeKinds,
	nodeLabels,
	removeCanvasElements,
} from "@kousa/projects/canvas";
import {
	connectionDependencies,
	planConnection,
} from "@kousa/projects/canvas-connections";
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
	type FinalConnectionState,
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
	ClipboardPasteIcon,
	CopyIcon,
	CopyPlusIcon,
	LayoutTemplateIcon,
	LocateFixedIcon,
	LockKeyholeIcon,
	MessageSquareIcon,
	MousePointer2Icon,
	Redo2Icon,
	ScanIcon,
	Trash2Icon,
	Undo2Icon,
	UploadIcon,
	WorkflowIcon,
	ZoomInIcon,
	ZoomOutIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaygroundCanvasImport } from "@/components/playground/canvas-import";
import { SaveTemplate } from "@/components/templates/save-template";
import { ClipContext, ClipMonitor, useCanvasClips } from "./canvas-clips";
import { GenerationContext, useCanvasGeneration } from "./canvas-generation";
import {
	CanvasGuide,
	StarterProgress,
	type StarterSession,
} from "./canvas-guide";
import { CanvasMediaProvider } from "./canvas-media";
import { CanvasCursors, CanvasPeople } from "./canvas-presence";
import { CanvasRecovery } from "./canvas-recovery";
import { CanvasRunHistory } from "./canvas-run-history";
import { WorkflowMonitor } from "./canvas-workflow";
import { ConnectionDialog, type ConnectionReview } from "./connection-preview";
import {
	type ImageVariationSession,
	ImageVariationsDialog,
	type InsertImageVariations,
} from "./image-variations-dialog";
import { MediaLibrary } from "./media-library";
import { MediaNode, nodeDescriptions, nodeIcons } from "./media-node";
import { NodeInspector } from "./node-inspector";
import { NodeSearch } from "./node-search";
import {
	documentFromGraph,
	type StudioEdge,
	type StudioGraph,
	type StudioNode,
	useCanvas,
} from "./use-canvas";
import { isCanvasTextTarget, useCanvasClipboard } from "./use-canvas-clipboard";
import { useCanvasMediaImport } from "./use-canvas-media-import";
import { WorkflowLauncher } from "./workflow-launcher";
import "@xyflow/react/dist/style.css";

const CanvasChat = dynamic(() =>
	import("./canvas-chat").then((module) => module.CanvasChat),
);

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
function ViewportControls({ selection }: { selection: { id: string }[] }) {
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
			<Button
				variant="ghost"
				size="icon"
				aria-label="Fit selection"
				title="Fit selection"
				disabled={!selection.length}
				onClick={() =>
					fitView({ ...fitOptions, nodes: selection, duration: 200 })
				}
			>
				<ScanIcon />
			</Button>
		</section>
	);
}

function Editor({
	userId,
	projectId,
	canvasId,
	canEdit: allowedToEdit,
}: {
	userId: string;
	projectId: string;
	canvasId: string;
	canEdit: boolean;
}) {
	const persistence = useCanvas(userId, projectId, canvasId, allowedToEdit);
	const { graph, dispatch, canUndo, canRedo, sync, canEdit, session } =
		persistence;
	const canRun =
		canEdit && sync.connection === "connected" && sync.sync === "synchronized";
	const clips = useCanvasClips(
		userId,
		projectId,
		canvasId,
		sync.loaded,
		canRun,
	);
	const generation = useCanvasGeneration({
		userId,
		projectId,
		canvasId,
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
	const focusFrame = useRef<number | undefined>(undefined);
	const { resolvedTheme } = useTheme();
	const [message, setMessage] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [guideOpen, setGuideOpen] = useState(false);
	const [chatOpen, setChatOpen] = useState(false);
	const [variationSession, setVariationSession] =
		useState<ImageVariationSession | null>(null);
	const [starterSession, setStarterSession] = useState<StarterSession | null>(
		null,
	);
	const capabilities = {
		image: generation.imageConfigured,
		speech: generation.speechConfigured,
		video: generation.videoConfigured,
		imageToVideo: generation.imageToVideoConfigured,
	};
	const [connectionReview, setConnectionReview] =
		useState<ConnectionReview | null>(null);
	const reconnecting = useRef<string | undefined>(undefined);
	const canvasDocument = useMemo(() => documentFromGraph(graph), [graph]);
	const selectedNodes = graph.nodes.filter((node) => node.selected);
	const selectedEdges = graph.edges.filter((edge) => edge.selected);
	const selectedNode =
		selectedNodes.length === 1 ? selectedNodes[0] : undefined;
	const selectionCount = selectedNodes.length + selectedEdges.length;
	const selectionToFit = [
		...new Set([
			...selectedNodes.map((node) => node.id),
			...selectedEdges.flatMap((edge) => [edge.source, edge.target]),
		]),
	].map((id) => ({ id }));
	const focusNode = useCallback(
		(id: string) => {
			const node = graph.nodes.find((node) => node.id === id);
			if (!node) {
				setMessage("That node is no longer on this canvas.");
				return;
			}
			dispatch({
				type: "nodes",
				changes: graph.nodes.map((node) => ({
					type: "select",
					id: node.id,
					selected: node.id === id,
				})),
			});
			dispatch({
				type: "edges",
				changes: graph.edges.map((edge) => ({
					type: "select",
					id: edge.id,
					selected: false,
				})),
			});
			if (focusFrame.current !== undefined)
				cancelAnimationFrame(focusFrame.current);
			// Wait for the inspector to open before measuring the remaining viewport.
			focusFrame.current = requestAnimationFrame(() => {
				void flow.fitView({
					nodes: [{ id }],
					padding: 0.5,
					maxZoom: 1,
					duration: 200,
				});
			});
			setMessage(
				`Focused ${node.data.label || nodeLabels[node.type ?? "text"]}.`,
			);
		},
		[dispatch, flow, graph.nodes, graph.edges],
	);
	useEffect(
		() => () => {
			if (focusFrame.current !== undefined)
				cancelAnimationFrame(focusFrame.current);
		},
		[],
	);

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
	const mediaImport = useCanvasMediaImport({
		userId,
		projectId,
		canUpload: canRun,
		remaining: 200 - graph.nodes.length,
		position: (point) => {
			const bounds = viewport.current?.getBoundingClientRect();
			if (!bounds) return undefined;
			return flow.screenToFlowPosition(
				point ?? {
					x: bounds.left + bounds.width / 2 - 130,
					y: bounds.top + bounds.height / 2 - 110,
				},
			);
		},
		onAssets: (assets, origin) => {
			if (!origin) return false;
			let added = false;
			dispatch({
				type: "edit",
				update: (current) => {
					if (current.nodes.length + assets.length > 200) return current;
					const nodes = clearSelection(current).nodes;
					for (const asset of assets) {
						const kind =
							asset.mimeType === "video/mp4"
								? "video"
								: asset.mimeType === "audio/mpeg"
									? "speech"
									: "image";
						const position = { ...origin };
						for (let slot = 0; slot < 500; slot++) {
							position.x = Math.max(
								-99_000,
								Math.min(99_000, origin.x + (slot % 2) * 380),
							);
							position.y = Math.max(
								-99_000,
								Math.min(99_000, origin.y + Math.floor(slot / 2) * 380),
							);
							if (
								!nodes.some(
									(node) =>
										Math.abs(node.position.x - position.x) < 310 &&
										Math.abs(node.position.y - position.y) < 350,
								)
							)
								break;
						}
						const node = createCanvasNode(kind, position);
						node.data = {
							...node.data,
							label: asset.name.slice(0, 80),
							assetId: asset.id,
							selectedRunId: null,
							imageSource: "project",
							mediaSource: "project",
						};
						nodes.push({ ...node, selected: true });
					}
					added = true;
					fitAfterAdd.current = true;
					return { nodes, edges: clearSelection(current).edges };
				},
			});
			return added;
		},
	});
	const { copy, paste, duplicate } = useCanvasClipboard({
		userId,
		projectId,
		graph,
		canEdit,
		root,
		viewport,
		dispatch,
		notify: setMessage,
		fitAfterAdd,
		pasteFiles: (files) => {
			void mediaImport.upload(files);
		},
	});
	const insertChat = (proposal: ChatProposal) => {
		let error: string | null =
			"You no longer have permission to edit this canvas.";
		dispatch({
			type: "edit",
			update: (current) => {
				try {
					const next = insertChatProposal(documentFromGraph(current), proposal);
					const added = new Set(proposal.graph.nodes.map((node) => node.id));
					error = null;
					fitAfterAdd.current = true;
					return {
						nodes: next.nodes.map((node) => ({
							...node,
							selected: added.has(node.id),
						})),
						edges: next.edges,
					};
				} catch (cause) {
					error =
						cause instanceof Error
							? cause.message
							: "Could not add this proposal.";
					return current;
				}
			},
		});
		if (!error) setMessage("Workflow added. Undo removes the full insertion.");
		return error;
	};
	const insertVariations: InsertImageVariations = (request, sourceKey) => {
		if (!canEdit)
			throw new Error("Editing access is required to create variations.");
		let ids: string[] = [];
		dispatch({
			type: "edit",
			update: (current) => {
				const document = documentFromGraph(current);
				if (imageVariationSourceKey(document, request.sourceId) !== sourceKey)
					throw new Error(
						"The source or its inputs changed. Reopen the variation builder.",
					);
				const insertion = createImageVariations(document, request);
				ids = insertion.targetIds;
				fitAfterAdd.current = true;
				return {
					nodes: [
						...clearSelection(current).nodes,
						...insertion.nodes.map((node) => ({
							...node,
							selected: ids.includes(node.id),
						})),
					],
					edges: [...clearSelection(current).edges, ...insertion.edges],
				};
			},
		});
		if (!ids.length)
			throw new Error(
				"The canvas is not ready to save. Reconnect with editing access and try again.",
			);
		setMessage(
			`${ids.length} image variations added. Review their cost before generating.`,
		);
		return ids;
	};
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
	const reviewConnection = useCallback(
		(value: Connection | Edge, reconnectId?: string) => {
			if (!canEdit) return;
			const connection = asConnection(value);
			if (connection) setConnectionReview({ connection, reconnectId });
		},
		[canEdit],
	);
	const validConnection = useCallback(
		(value: Connection | Edge) => {
			const connection = asConnection(value);
			if (!canEdit || !connection) return false;
			const plan = planConnection(
				canvasDocument,
				connection,
				reconnecting.current,
			);
			const input = resolveConnection(canvasDocument, connection);
			return !plan.error && input?.usage !== "unsupported";
		},
		[canEdit, canvasDocument],
	);
	const endConnection = (state: FinalConnectionState) => {
		if (!canEdit || state.isValid || !state.fromHandle || !state.toHandle)
			return;
		const source =
			state.fromHandle.type === "source" ? state.fromHandle : state.toHandle;
		const target =
			state.fromHandle.type === "target" ? state.fromHandle : state.toHandle;
		if (source.type !== "source" || target.type !== "target") {
			setMessage("Connect an output dot to an input dot.");
			return;
		}
		reviewConnection(
			{
				source: source.nodeId,
				target: target.nodeId,
				sourceHandle: source.id ?? null,
				targetHandle: target.id ?? null,
			},
			reconnecting.current,
		);
	};
	const dependencies = useMemo(
		() =>
			connectionDependencies(
				canvasDocument,
				graph.nodes.filter((node) => node.selected).map((node) => node.id),
			),
		[canvasDocument, graph.nodes],
	);
	const displayNodes = useMemo(
		() =>
			graph.nodes.map((node) => ({
				...node,
				ariaLabel: `${node.data.label || nodeLabels[node.type ?? "text"]}, ${nodeLabels[node.type ?? "text"]} node`,
				className: cn(
					dependencies.upstream.nodes.has(node.id) && "studio-upstream",
					dependencies.downstream.nodes.has(node.id) && "studio-downstream",
				),
			})),
		[graph.nodes, dependencies],
	);
	const displayEdges = useMemo(
		() =>
			graph.edges.map((edge) => {
				const input = resolveConnection(canvasDocument, edge);
				const composition = input?.usage === "composition";
				const highlighted =
					dependencies.upstream.edges.has(edge.id) ||
					dependencies.downstream.edges.has(edge.id);
				return {
					...edge,
					label: composition
						? "Composition"
						: input?.usage === "unsupported"
							? "Unsupported"
							: undefined,
					ariaLabel: `${input?.source.data.label ?? "Output"} to ${input?.target.data.label ?? "node"} ${edge.targetHandle}${composition ? ", composition only" : ""}`,
					style: {
						strokeWidth: highlighted ? 3 : 1.7,
						...(highlighted ? { stroke: "var(--ring)" } : {}),
						...(composition ? { strokeDasharray: "5 4" } : {}),
					},
				};
			}),
		[graph.edges, canvasDocument, dependencies],
	);

	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			const inCanvas = root.current?.contains(document.activeElement);
			const target = event.target;
			if (event.defaultPrevented || isCanvasTextTarget(target) || event.altKey)
				return;
			if (
				(inCanvas || document.activeElement === document.body) &&
				(event.metaKey || event.ctrlKey) &&
				!event.shiftKey &&
				event.key.toLowerCase() === "k" &&
				sync.loaded
			) {
				event.preventDefault();
				setSearchOpen(true);
				return;
			}
			if (
				(inCanvas || document.activeElement === document.body) &&
				!event.metaKey &&
				!event.ctrlKey &&
				event.key === "?"
			) {
				event.preventDefault();
				setGuideOpen(true);
				return;
			}
			if (!inCanvas) return;
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === "z" &&
				canEdit
			) {
				event.preventDefault();
				dispatch({ type: event.shiftKey ? "redo" : "undo" });
			} else if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === "a"
			) {
				event.preventDefault();
				dispatch({
					type: "nodes",
					changes: graph.nodes.map((node) => ({
						type: "select",
						id: node.id,
						selected: true,
					})),
				});
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
		graph.nodes,
		sync.loaded,
	]);

	function addStarter(kind: StarterKind) {
		if (!canEdit || starterUnavailable(kind, capabilities)) return false;
		let example: StarterSession | null = null;
		dispatch({
			type: "edit",
			update: (current) => {
				if (current.nodes.length + (kind === "image-video" ? 3 : 2) > 200)
					return current;
				example = createCanvasStarter(kind, {
					x: 0,
					y: current.nodes.length
						? Math.min(
								97_000,
								Math.max(...current.nodes.map((node) => node.position.y)) + 420,
							)
						: 0,
				});
				fitAfterAdd.current = true;
				return {
					nodes: [
						...clearSelection(current).nodes,
						...example.document.nodes.map((node) => ({
							...node,
							selected: node.id === example?.steps[0]?.nodeId,
						})),
					],
					edges: [...clearSelection(current).edges, ...example.document.edges],
				};
			},
		});
		if (example) {
			setStarterSession(example);
			setMessage("Example added. Review the next step before generating.");
		}
		return !!example;
	}

	const importPlaygroundNode = useCallback(
		(node: CanvasNode) => {
			if (!canRun) return false;
			if (graph.nodes.some((n) => n.id === node.id)) return true;
			if (graph.nodes.length >= 200) {
				setMessage("This canvas has reached its 200-node limit.");
				return false;
			}
			const position = {
				x: 0,
				y: graph.nodes.length
					? Math.min(
							97_000,
							Math.max(...graph.nodes.map((n) => n.position.y)) + 420,
						)
					: 0,
			};
			fitAfterAdd.current = true;
			dispatch({
				type: "edit",
				update: (current) =>
					current.nodes.some((n) => n.id === node.id) ||
					current.nodes.length >= 200
						? current
						: {
								...clearSelection(current),
								nodes: [
									...clearSelection(current).nodes,
									{ ...node, position, selected: true },
								],
							},
			});
			setMessage("Generation added from Playground. No credits used.");
			void generation.refresh();
			return true;
		},
		[canRun, graph.nodes, dispatch, generation.refresh],
	);

	const content = (
		<div className="studio-editor" ref={root}>
			<PlaygroundCanvasImport
				userId={userId}
				projectId={projectId}
				canvasId={canvasId}
				ready={canRun}
				onImport={importPlaygroundNode}
			/>
			<div className="studio-toolbar">
				<Button
					variant={chatOpen ? "secondary" : "outline"}
					size="sm"
					disabled={!canEdit}
					aria-label="Canvas chat"
					aria-expanded={chatOpen}
					onClick={() => setChatOpen((open) => !open)}
				>
					<MessageSquareIcon data-icon="inline-start" />
					Chat
				</Button>
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
				<div className="ml-auto flex flex-wrap items-center justify-end gap-1">
					<CanvasGuide
						open={guideOpen}
						onOpenChange={setGuideOpen}
						canEdit={canEdit}
						remaining={200 - graph.nodes.length}
						capabilities={capabilities}
						onStarter={addStarter}
					/>
					<input
						ref={mediaImport.input}
						type="file"
						hidden
						multiple
						accept={uploadAccept}
						aria-label="Upload canvas media"
						onChange={(event) => {
							const files = Array.from(event.currentTarget.files ?? []);
							event.currentTarget.value = "";
							void mediaImport.upload(files);
						}}
					/>
					<Button
						variant="ghost"
						disabled={
							!canRun || !!mediaImport.progress || graph.nodes.length >= 200
						}
						title={uploadFormats}
						onClick={() => mediaImport.input.current?.click()}
					>
						<UploadIcon data-icon="inline-start" />
						Upload media
					</Button>
					<NodeSearch
						nodes={canvasDocument.nodes}
						open={searchOpen}
						onOpenChange={setSearchOpen}
						onFocus={focusNode}
						loaded={sync.loaded}
					/>
					{allowedToEdit ? (
						<SaveTemplate
							userId={userId}
							projectId={projectId}
							canvasId={canvasId}
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
					<CanvasRunHistory
						key={`${userId}:${projectId}:${canvasId}`}
						generation={generation}
						canEdit={canEdit}
						onFocus={focusNode}
					/>
					<WorkflowMonitor workflow={generation.workflow} />
					{variationSession ? (
						<ImageVariationsDialog
							graph={canvasDocument}
							initial={variationSession}
							canEdit={canEdit}
							workflow={generation.workflow}
							insert={insertVariations}
							close={() => setVariationSession(null)}
						/>
					) : null}
					<ClipMonitor />
					{session ? <CanvasPeople session={session} /> : null}
					<Button
						variant="ghost"
						size="icon"
						disabled={!selectedNodes.length}
						onClick={copy}
						aria-label="Copy selection"
						title="Copy selection · ⌘/Ctrl C"
					>
						<CopyIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={!canEdit || !selectedNodes.length}
						onClick={duplicate}
						aria-label="Duplicate selection"
						title="Duplicate selection · ⌘/Ctrl D"
					>
						<CopyPlusIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={!canEdit}
						onClick={paste}
						aria-label="Paste nodes"
						title="Paste nodes · ⌘/Ctrl V"
					>
						<ClipboardPasteIcon />
					</Button>
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
			{mediaImport.progress ? (
				<p role="status" className="px-4 py-2 text-muted-foreground text-xs">
					{mediaImport.progress}. Keep this tab open until the upload finishes.
				</p>
			) : null}
			{mediaImport.error ? (
				<Alert variant="destructive">
					<AlertTitle>Media import needs attention</AlertTitle>
					<AlertDescription>
						<p>{mediaImport.error}</p>
						<div className="flex flex-wrap gap-2">
							{mediaImport.retry ? (
								<Button
									variant="outline"
									size="sm"
									disabled={!canRun || !!mediaImport.progress}
									onClick={() => {
										if (mediaImport.retry)
											void mediaImport.upload(
												mediaImport.retry.files,
												mediaImport.retry.point,
											);
									}}
								>
									Retry remaining files
								</Button>
							) : null}
							<Button variant="ghost" size="sm" onClick={mediaImport.dismiss}>
								Dismiss upload message
							</Button>
						</div>
					</AlertDescription>
				</Alert>
			) : null}
			{starterSession ? (
				<StarterProgress
					session={starterSession}
					focus={focusNode}
					dismiss={() => setStarterSession(null)}
				/>
			) : null}
			<CanvasRecovery
				sync={sync}
				allowedToEdit={allowedToEdit}
				retry={persistence.retry}
				download={() => persistence.download()}
			/>
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
					tabIndex={-1}
					{...mediaImport.dropHandlers}
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
						nodes={displayNodes}
						edges={displayEdges}
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
						onConnect={(value) => reviewConnection(value)}
						onReconnectStart={(_, edge) => {
							reconnecting.current = edge.id;
						}}
						onReconnect={(edge, value) => reviewConnection(value, edge.id)}
						onReconnectEnd={(_, __, ___, state) => {
							endConnection(state);
							reconnecting.current = undefined;
						}}
						onEdgeDoubleClick={(_, edge) => reviewConnection(edge, edge.id)}
						onPaneClick={() => viewport.current?.focus({ preventScroll: true })}
						isValidConnection={validConnection}
						onConnectEnd={(_, state) => endConnection(state)}
						onClickConnectEnd={(_, state) => endConnection(state)}
						nodesDraggable={canEdit}
						nodesConnectable={canEdit}
						edgesReconnectable={canEdit}
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
						<ViewportControls selection={selectionToFit} />
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
					{mediaImport.dragging ? (
						<div className="studio-drop-target" role="status">
							<p>
								{canRun
									? "Drop media to create nodes"
									: "Reconnect with editing access to upload media"}
							</p>
							<p className="text-xs">
								{uploadFormats}. MP3: 3 minutes; MP4: 12 seconds.
							</p>
						</div>
					) : null}
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
											? "Choose an example to follow, add a Text node, or drop supported media here. Nothing generates until you choose to run it."
											: "An owner or editor can add nodes to this project. Their changes will appear here live."}
									</EmptyDescription>
								</EmptyHeader>
								{canEdit ? (
									<div className="flex flex-col items-center gap-3">
										<Button onClick={() => addNode("text")}>
											<nodeIcons.text data-icon="inline-start" />
											Add a text node
										</Button>
										<Button variant="ghost" onClick={() => setGuideOpen(true)}>
											<LayoutTemplateIcon data-icon="inline-start" />
											Choose a starter example
										</Button>
									</div>
								) : (
									<LockKeyholeIcon className="size-5 text-muted-foreground" />
								)}
							</Empty>
						</div>
					) : null}
					{selectedNodes.length > 1 ? (
						<div className="studio-selection-info">
							<span>
								{selectedNodes.length} nodes selected · Internal connections
								included when copying
							</span>
						</div>
					) : null}
					{selectedEdges.length > 0 && !selectedNodes.length ? (
						<div className="studio-selection-info">
							<span>
								{selectedEdges.length} connection
								{selectedEdges.length === 1 ? "" : "s"} selected
							</span>
							{selectedEdges.length === 1 ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										const edge = selectedEdges[0];
										if (edge)
											setConnectionReview({
												connection: edge,
												reconnectId: edge.id,
											});
									}}
								>
									Review connection
								</Button>
							) : null}
							{canEdit ? (
								<Button variant="outline" size="sm" onClick={removeSelected}>
									Disconnect
								</Button>
							) : null}
						</div>
					) : null}
				</div>
				{chatOpen ? (
					<CanvasChat
						key={`${userId}:${canvasId}`}
						userId={userId}
						projectId={projectId}
						canvasId={canvasId}
						graph={canvasDocument}
						canEdit={canEdit}
						canRun={canRun}
						workflow={generation.workflow}
						insert={insertChat}
						close={() => setChatOpen(false)}
					/>
				) : null}
				{selectedNode && !chatOpen ? (
					<NodeInspector
						node={selectedNode}
						reviewConnection={(connection, reconnectId) =>
							setConnectionReview({ connection, reconnectId })
						}
						nodes={graph.nodes}
						edges={graph.edges}
						canEdit={canEdit}
						model={persistence.model}
						update={update}
						endEdit={() => dispatch({ type: "end" })}
						remove={removeSelected}
						createVariations={(assetId) => {
							const source = canvasDocument.nodes.find(
								(node) => node.id === selectedNode.id,
							);
							if (source)
								setVariationSession({
									source,
									sourceKey: imageVariationSourceKey(canvasDocument, source.id),
									assetId,
								});
						}}
						addImage={(asset) =>
							addNode("image", {
								assetId: asset.id,
								imageSource: "project",
								label: asset.name.slice(0, 80),
							})
						}
						applyHistory={(before, patch) => {
							if (!canEdit) return false;
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
										canonical(node.data) !== canonical(before.data)
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
						close={() => {
							dispatch({
								type: "nodes",
								changes: [
									{ type: "select", id: selectedNode.id, selected: false },
								],
							});
							viewport.current?.focus({ preventScroll: true });
						}}
					/>
				) : null}
			</div>
			{connectionReview ? (
				<ConnectionDialog
					graph={canvasDocument}
					review={connectionReview}
					canEdit={canEdit}
					close={() => {
						setConnectionReview(null);
						viewport.current?.focus({ preventScroll: true });
					}}
					apply={(review, expectedRemoved) => {
						let error: string | null =
							"You no longer have permission to edit this canvas.";
						dispatch({
							type: "edit",
							update: (current) => {
								const graph = documentFromGraph(current);
								const plan = planConnection(
									graph,
									review.connection,
									review.reconnectId,
								);
								const input = resolveConnection(graph, review.connection);
								error =
									plan.error ??
									(input?.usage === "unsupported" ? input.description : null);
								if (!error && JSON.stringify(plan.removed) !== expectedRemoved)
									error =
										"This input changed while you were reviewing it. Review the current connection and try again.";
								if (error) return current;
								// A new edge ID makes endpoint changes visible to the shared document.
								const removed = new Set(plan.removed.map((edge) => edge.id));
								return {
									...current,
									edges: [
										...current.edges.filter((edge) => !removed.has(edge.id)),
										{ id: crypto.randomUUID(), ...review.connection },
									],
								};
							},
						});
						if (!error)
							setMessage(
								"Connection saved. Undo restores the previous connections.",
							);
						return error;
					}}
				/>
			) : null}
			<footer className="studio-statusbar">
				<div
					className={cn(
						"flex items-center gap-1.5",
						saveError && "text-destructive",
					)}
					role="status"
					title={saveError ?? "Changes sync live with everyone on this canvas."}
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
	canvasId: string;
	canEdit: boolean;
}) {
	return (
		<ReactFlowProvider>
			<Editor {...props} />
		</ReactFlowProvider>
	);
}
