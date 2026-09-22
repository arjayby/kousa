"use client";

import {
	defaultImageModel,
	defaultVideoModel,
	isRunActive,
	type PublicRun,
	resolveTextModel,
	runProgress,
} from "@kousa/generation/contracts";
import { type Freshness, graphFreshness } from "@kousa/generation/freshness";
import {
	generationInputHash,
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
	videoInputImageAssetId,
	videoInputSnapshot,
} from "@kousa/generation/input";
import {
	defaultVoiceFor,
	imageSizeFor,
	modelCreditCost,
	modelSettingsPatch,
	resolveSpeechModel,
	speechProfile,
	validateModelSettings,
	videoProfile,
	voicesFor,
} from "@kousa/generation/model-catalog";
import { generationBlockReason } from "@kousa/generation/readiness";
import type { CanvasNode } from "@kousa/projects/canvas";
import { nodeGenerationKind } from "@kousa/projects/canvas";
import { Button } from "@kousa/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@kousa/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kousa/ui/components/select";
import { Textarea } from "@kousa/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, LoaderCircleIcon, PlayIcon } from "lucide-react";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ModelPicker } from "@/components/model-picker";
import { client, orpc } from "@/utils/orpc";
import {
	AssetDownload,
	AssetPreview,
	AudioPreview,
	VideoPreview,
} from "./canvas-media";
import { useGraphRuns, WorkflowControls } from "./canvas-workflow";
import {
	documentFromGraph,
	type StudioGraph,
	type StudioNode,
} from "./use-canvas";

type Request = Parameters<typeof client.generation.generate>[0];
export function useCanvasGeneration({
	userId,
	projectId,
	canvasId,
	graph,
	canRun,
	loaded,
}: {
	userId: string;
	projectId: string;
	canvasId: string;
	graph: StudioGraph;
	canRun: boolean;
	loaded: boolean;
}) {
	const cache = useQueryClient();
	const workflow = useGraphRuns({
		userId,
		projectId,
		canvasId,
		graph,
		canRun,
		loaded,
	});
	const nodeIds = graph.nodes
		.filter(
			(n) =>
				n.type === "text" ||
				n.type === "image" ||
				n.type === "audio" ||
				n.type === "video",
		)
		.map((n) => n.id)
		.sort();
	const selections = graph.nodes
		.flatMap((node) =>
			node.data.selectedRunId
				? [{ nodeId: node.id, runId: node.data.selectedRunId }]
				: [],
		)
		.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
	const query = useQuery({
		...orpc.generation.list.queryOptions({
			input: { projectId, canvasId, nodeIds, selections },
		}),
		queryKey: ["generation", userId, projectId, canvasId, nodeIds, selections],
		enabled: loaded,
		refetchInterval: 3_000,
		retry: false,
	});
	const freshness = useMemo(
		() =>
			query.data
				? graphFreshness(documentFromGraph(graph), [
						...query.data.textResults,
						...query.data.imageResults,
						...query.data.speechResults,
						...query.data.videoResults,
						...query.data.selectedResults,
					])
				: new Map<string, Freshness>(),
		[graph, query.data],
	);
	const [error, setError] = useState<{
		nodeId: string;
		message: string;
	} | null>(null);
	const [pendingNode, setPendingNode] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState<Request | null>(null);
	const busy = useRef(false);
	const mutation = useMutation({
		mutationFn: (input: Request) => client.generation.generate(input),
		retry: false,
	});
	const runs = new Map(
		(query.data?.runs ?? []).map((run) => [run.nodeId, run]),
	);
	const selected = new Map(
		(query.data?.selectedResults ?? []).map((run) => [run.id, run]),
	);
	function outputs(kind: PublicRun["kind"], latest: PublicRun[] = []) {
		const results = new Map(latest.map((run) => [run.nodeId, run]));
		for (const node of graph.nodes) {
			if (nodeGenerationKind(node.type) !== kind || !node.data.selectedRunId)
				continue;
			results.delete(node.id);
			const run = selected.get(node.data.selectedRunId);
			if (run?.nodeId === node.id && run.kind === kind)
				results.set(node.id, run);
		}
		return results;
	}
	const imageResults = outputs("image", query.data?.imageResults);
	async function run(nodeId: string) {
		if (!canRun || busy.current) return;
		busy.current = true;
		setPendingNode(nodeId);
		setError(null);
		let request: Request | null =
			uncertain?.nodeId === nodeId ? uncertain : null;
		try {
			if (!request) {
				const document = documentFromGraph(graph);
				const kind = document.nodes.find((node) => node.id === nodeId)?.type;
				const imageInput =
					kind === "video"
						? videoInputSnapshot(document, nodeId)
						: kind === "image"
							? imageInputSnapshot(document, nodeId)
							: null;
				const inputImageAssetId = imageInput
					? videoInputImageAssetId(
							imageInput,
							imageResults.get(imageInput.image?.nodeId ?? "")?.assetId,
						)
					: null;
				request = {
					id: crypto.randomUUID(),
					projectId,
					canvasId,
					nodeId,
					inputHash: await generationInputHash(document, nodeId),
					...(inputImageAssetId ? { inputImageAssetId } : {}),
				};
			}
			const result = await mutation.mutateAsync(request);
			setUncertain(null);
			if (result.status === "failed")
				setError({ nodeId, message: result.error ?? "Generation failed." });
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : "Could not confirm the run.";
			const code =
				cause && typeof cause === "object" && "code" in cause
					? cause.code
					: null;
			// An ambiguous transport/server failure keeps the same request ID. Checking
			// it can recover a result without making another paid provider call.
			const definitive = [
				"BAD_REQUEST",
				"FORBIDDEN",
				"NOT_FOUND",
				"CONFLICT",
				"PAYMENT_REQUIRED",
				"SERVICE_UNAVAILABLE",
				"UNAUTHORIZED",
			].includes(String(code));
			setUncertain(definitive ? null : request);
			setError({
				nodeId,
				message:
					definitive || !request
						? message
						: "Connection interrupted. Check this run before starting another.",
			});
		} finally {
			busy.current = false;
			setPendingNode(null);
			await Promise.allSettled([
				cache.invalidateQueries({
					queryKey: ["generation", userId, projectId],
				}),
				cache.invalidateQueries({ queryKey: ["credits", userId] }),
				cache.invalidateQueries({ queryKey: ["media", userId, projectId] }),
			]);
		}
	}
	return {
		loaded,
		workflow,
		freshness,
		userId,
		projectId,
		canvasId,
		runs,
		imageResults,
		textResults: outputs("text", query.data?.textResults),
		imageConfigured: query.data?.imageConfigured,
		speechResults: outputs("speech", query.data?.speechResults),
		speechConfigured: query.data?.speechConfigured,
		videoConfigured: query.data?.videoConfigured,
		imageToVideoConfigured: query.data?.imageToVideoConfigured,
		videoResults: outputs("video", query.data?.videoResults),
		run,
		balance: query.data?.balance,
		configured: query.data?.configured,
		loading: query.isPending,
		queryError: query.isError,
		refresh: () => query.refetch(),
		pendingNode,
		uncertain,
		error,
		canRun,
		graph,
		myRunActive:
			!!workflow.active ||
			workflow.pending ||
			workflow.uncertain ||
			(query.data?.runs ?? []).some(
				(r) => r.userId === userId && isRunActive(r),
			),
	};
}
type GenerationContextValue = ReturnType<typeof useCanvasGeneration>;
export const GenerationContext = createContext<GenerationContextValue | null>(
	null,
);
export function useNodeFreshness(id: string) {
	return useContext(GenerationContext)?.freshness.get(id);
}
export function useNodeRun(id: string): PublicRun | undefined {
	return useContext(GenerationContext)?.runs.get(id);
}
export function useWorkflowStep(id: string) {
	const workflow = useContext(GenerationContext)?.workflow;
	const run = workflow?.active ?? workflow?.latest;
	return run?.steps.find((step) => step.nodeId === id);
}

export function useNodeText(id: string): PublicRun | undefined {
	return useContext(GenerationContext)?.textResults.get(id);
}
export function useNodeImage(id: string): PublicRun | undefined {
	return useContext(GenerationContext)?.imageResults.get(id);
}
export function useNodeVideo(id: string): PublicRun | undefined {
	return useContext(GenerationContext)?.videoResults.get(id);
}
export function useNodeSpeech(id: string): PublicRun | undefined {
	return useContext(GenerationContext)?.speechResults.get(id);
}
export function GenerationPanel({
	node,
	canEdit,
	update,
}: {
	node: StudioNode;
	canEdit: boolean;
	update: (data: Partial<CanvasNode["data"]>, field: string) => void;
}) {
	const generation = useContext(GenerationContext);
	if (!generation) return null;
	const kind = nodeGenerationKind(node.type ?? "text");
	const settings = {
		video: {
			configured: generation.videoConfigured,
			model: node.data.videoModel ?? defaultVideoModel,
			snapshot: videoInputSnapshot,
		},
		text: {
			configured: generation.configured,
			model: resolveTextModel(node.data.textModel),
			snapshot: textInputSnapshot,
		},
		image: {
			configured: generation.imageConfigured,
			model: node.data.imageModel ?? defaultImageModel,
			snapshot: imageInputSnapshot,
		},
		speech: {
			configured: generation.speechConfigured,
			model: resolveSpeechModel(node.data.speechModel),
			snapshot: speechInputSnapshot,
		},
	}[kind];
	const { configured } = settings;
	const cost = modelCreditCost(
		kind,
		settings.model,
		node.data.duration,
		node.data.imageQuality,
	);
	const voiceItems = voicesFor(settings.model).map((voice) => ({
		value: voice.id,
		label: voice.name,
	}));
	const speechResult = generation.speechResults.get(node.id);
	const videoResult = generation.videoResults.get(node.id);
	const imageResult = generation.imageResults.get(node.id);
	const textResult = generation.textResults.get(node.id);
	const run = generation.runs.get(node.id);
	const pending = generation.pendingNode === node.id || isRunActive(run);
	const checking = generation.uncertain?.nodeId === node.id;
	let inputError: string | null = null;
	let inputImageAssetId: string | null = null;
	let imageNode: StudioNode | undefined;
	try {
		settings.snapshot(documentFromGraph(generation.graph), node.id);
		if (kind === "video" || kind === "image") {
			const snapshot = (
				kind === "video" ? videoInputSnapshot : imageInputSnapshot
			)(documentFromGraph(generation.graph), node.id);
			if (snapshot.image) {
				imageNode = generation.graph.nodes.find(
					(node) => node.id === snapshot.image?.nodeId,
				);
				inputImageAssetId = videoInputImageAssetId(
					snapshot,
					generation.imageResults.get(snapshot.image.nodeId)?.assetId,
				);
				if (!inputImageAssetId)
					inputError =
						"Upload or generate an image on the connected image node first.";
				else if (kind === "video" && !generation.imageToVideoConfigured)
					inputError =
						"Image-to-video needs a public HTTPS app URL so the provider can fetch this image.";
			}
		}
	} catch (error) {
		inputError = error instanceof Error ? error.message : "Invalid input.";
	}
	inputError ??= validateModelSettings(
		{
			kind,
			modelId: settings.model,
			...node.data,
			voiceId: node.data.voiceId ?? defaultVoiceFor(settings.model),
		},
		Boolean(imageNode),
	);
	const error = pending
		? null
		: generation.error?.nodeId === node.id
			? generation.error.message
			: run?.error;
	const blockedReason = generationBlockReason({
		canRun: generation.canRun,
		loading: generation.loading,
		queryError: generation.queryError,
		configured,
		pendingNode: Boolean(generation.pendingNode),
		checking,
		pending,
		myRunActive: generation.myRunActive,
		uncertain: Boolean(generation.uncertain),
		balance: generation.balance,
		cost,
		inputError,
		empty:
			!node.data.content.trim() &&
			!inputImageAssetId &&
			(kind === "text" ||
				!generation.graph.edges.some(
					(edge) =>
						edge.target === node.id &&
						edge.targetHandle === (kind === "speech" ? "script" : "prompt"),
				)),
	});
	const disabled = Boolean(blockedReason);
	return (
		<section
			className="flex flex-col gap-4 border-t pt-4"
			aria-label={`${kind[0]?.toUpperCase()}${kind.slice(1)} generation`}
		>
			{generation.freshness.get(node.id)?.runId ? (
				<p role="status" className="text-muted-foreground text-xs">
					{generation.freshness.get(node.id)?.state === "current"
						? "Up to date"
						: "Outdated"}
					. {generation.freshness.get(node.id)?.reason}
				</p>
			) : null}
			<Field>
				<FieldLabel htmlFor={`${kind}-model`}>Model</FieldLabel>
				<ModelPicker
					id={`${kind}-model`}
					kind={kind}
					value={settings.model}
					disabled={!canEdit || pending}
					onChange={(value) =>
						update(modelSettingsPatch(kind, value, node.data), `${kind}Model`)
					}
				/>
				<FieldDescription>
					{cost} Kousa {cost === 1 ? "credit" : "credits"} per successful run ·{" "}
					{kind === "video"
						? `MP4 · ${videoProfile(settings.model).resolutionLabel} · ${node.data.duration} seconds`
						: kind === "image"
							? settings.model === "quiverai/arrow-1.1"
								? "Vector rendered as PNG"
								: settings.model === "meta/muse-image-1.0"
									? "Automatic dimensions"
									: `${imageSizeFor(settings.model, node.data.aspectRatio).replace("x", " × ")} target pixels`
							: kind === "speech"
								? "MP3 · Up to 1,000 script characters"
								: "Up to 2,048 output tokens"}
					.
				</FieldDescription>
				<FieldDescription>
					Credits are reserved when you start and charged on success.
				</FieldDescription>
			</Field>
			{imageNode ? (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-xs">
						{kind === "image" ? "Reference image" : "Starting image"} ·{" "}
						{imageNode.data.label}
					</h3>
					{inputImageAssetId ? (
						<AssetPreview key={inputImageAssetId} assetId={inputImageAssetId} />
					) : null}
					<p className="text-muted-foreground text-xs">
						{kind === "image"
							? "Describe what to change and what to keep. The edit is saved as a new image; your reference stays available."
							: "Uses this image node’s selected output. Add a motion prompt, or leave it empty to let the model animate the image."}
					</p>
				</div>
			) : null}
			{kind === "speech" ? (
				<Field>
					<FieldLabel htmlFor="speech-voice">Voice</FieldLabel>
					<Select
						items={voiceItems}
						value={node.data.voiceId ?? defaultVoiceFor(settings.model)}
						disabled={!canEdit || pending}
						onValueChange={(value) => {
							if (value) update({ voiceId: value }, "voiceId");
						}}
					>
						<SelectTrigger id="speech-voice" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{voiceItems.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<FieldDescription>
						{speechProfile(settings.model).description}
					</FieldDescription>
				</Field>
			) : null}
			{canEdit ? (
				<div className="flex flex-col gap-2">
					<Button
						disabled={disabled}
						aria-describedby={
							blockedReason ? `generation-blocked-${node.id}` : undefined
						}
						onClick={() => {
							if (kind === "image" && !checking)
								update({ imageSource: "generated" }, "imageSource");
							void generation.run(node.id);
						}}
					>
						{pending ? (
							<LoaderCircleIcon
								data-icon="inline-start"
								className="animate-spin"
							/>
						) : (
							<PlayIcon data-icon="inline-start" />
						)}
						{checking
							? "Check run"
							: pending
								? (runProgress(run) ?? "Queuing…")
								: generation.freshness.get(node.id)?.runId
									? "Force regenerate"
									: `Generate ${kind}`}
					</Button>
					<p className="text-muted-foreground text-xs">
						Your balance: {generation.balance ?? "…"} credits. Uses your
						credits.
					</p>
					{blockedReason ? (
						<p
							id={`generation-blocked-${node.id}`}
							role="status"
							className="text-muted-foreground text-xs"
						>
							{blockedReason}
						</p>
					) : null}
					{generation.queryError ||
					(!generation.loading && (generation.balance ?? 0) < cost) ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => void generation.refresh()}
						>
							Refresh generation status
						</Button>
					) : null}
				</div>
			) : (
				<p className="text-muted-foreground text-xs">
					Only owners and editors can generate. Results are shared with
					everyone.
				</p>
			)}
			<WorkflowControls
				workflow={generation.workflow}
				nodeId={node.id}
				canEdit={canEdit}
				onStart={
					kind === "image"
						? () => update({ imageSource: "generated" }, "imageSource")
						: undefined
				}
			/>
			{pending ? (
				<p role="status" className="text-muted-foreground text-xs">
					{runProgress(run) ?? "Queuing…"} You can leave this page. The result
					will be saved to this project.
				</p>
			) : null}
			{error ? (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : null}
			{kind === "image" ? (
				<div className="flex flex-col gap-3">
					<p className="text-muted-foreground text-xs">
						Uses the prompt and connected text. Connect an Image node to
						Reference to edit an uploaded photo or a saved image output.
					</p>
					{imageResult?.assetId ? (
						<>
							<h3 className="font-medium text-xs">Selected image output</h3>
							<AssetPreview
								key={imageResult.assetId}
								assetId={imageResult.assetId}
							/>
							<AssetDownload assetId={imageResult.assetId} />
							<p className="text-muted-foreground text-xs">
								Saved to this project. Generate again to apply prompt changes.
							</p>
						</>
					) : null}
				</div>
			) : null}

			{kind === "speech" ? (
				<div className="flex flex-col gap-3">
					<p className="text-muted-foreground text-xs">
						Generate speech reads the connected text's last successful output,
						or its written text, followed by this script. Run affected steps
						updates affected connected text first.
					</p>
					{speechResult?.assetId ? (
						<>
							<h3 className="font-medium text-xs">Selected audio output</h3>
							<AudioPreview
								key={speechResult.assetId}
								assetId={speechResult.assetId}
								transcript={speechResult.transcript}
							/>
							<AssetDownload assetId={speechResult.assetId} kind="audio" />
							<p className="text-muted-foreground text-xs">
								Saved to this project. Generate again to apply script or voice
								changes.
							</p>
						</>
					) : null}
				</div>
			) : null}

			{kind === "video" ? (
				<div className="flex flex-col gap-3">
					<p className="text-muted-foreground text-xs">
						Creates a clip from text or a connected image, depending on the
						model. Some models include generated audio. Connect an Audio node to
						replace it with your own soundtrack using Create clip.
						Video-to-video generation is not yet available.
					</p>
					{videoResult?.assetId ? (
						<>
							<h3 className="font-medium text-xs">Selected video output</h3>
							<VideoPreview
								key={videoResult.assetId}
								assetId={videoResult.assetId}
							/>
							<AssetDownload assetId={videoResult.assetId} kind="video" />
							<p className="text-muted-foreground text-xs">
								Saved to this project. Generate again to apply prompt or
								duration changes.
							</p>
						</>
					) : null}
				</div>
			) : null}
			{textResult?.output ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<h3 className="font-medium text-xs">Selected text output</h3>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Copy generated text"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(textResult.output ?? "");
									toast.success("Text copied");
								} catch {
									toast.error(
										"Could not copy. Select the output and copy it manually.",
									);
								}
							}}
						>
							<CopyIcon />
						</Button>
					</div>
					<Textarea
						readOnly
						value={textResult.output}
						className="max-h-80 min-h-48 resize-y bg-muted/30 text-xs leading-relaxed"
						aria-label="Generated text"
					/>
					<p className="text-muted-foreground text-xs">
						Saved result. Run again to apply prompt changes. Connected text uses
						its last successful output, or its written text before the first
						run.
					</p>
				</div>
			) : null}
		</section>
	);
}
