"use client";

import {
	defaultImageModel,
	defaultSpeechModel,
	defaultSpeechVoice,
	defaultVideoModel,
	imageCreditCost,
	imageModels,
	imageSizes,
	isRunActive,
	type PublicRun,
	resolveTextModel,
	runProgress,
	speechCreditCost,
	speechModels,
	speechVoices,
	textCreditCost,
	textModels,
	videoCreditCost,
	videoModels,
} from "@kousa/generation/contracts";
import {
	generationInputHash,
	imageInputSnapshot,
	speechInputSnapshot,
	textInputSnapshot,
	videoInputImageAssetId,
	videoInputSnapshot,
} from "@kousa/generation/input";
import type { CanvasNode } from "@kousa/projects/canvas";
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
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
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
	graph,
	canRun,
	loaded,
}: {
	userId: string;
	projectId: string;
	graph: StudioGraph;
	canRun: boolean;
	loaded: boolean;
}) {
	const cache = useQueryClient();
	const workflow = useGraphRuns({ userId, projectId, graph, canRun, loaded });
	const nodeIds = graph.nodes
		.filter(
			(n) =>
				n.type === "text" ||
				n.type === "image" ||
				n.type === "speech" ||
				n.type === "video",
		)
		.map((n) => n.id)
		.sort();
	const query = useQuery({
		...orpc.generation.list.queryOptions({ input: { projectId, nodeIds } }),
		queryKey: ["generation", userId, projectId, nodeIds],
		enabled: loaded,
		refetchInterval: 3_000,
		retry: false,
	});
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
				const videoInput =
					document.nodes.find((node) => node.id === nodeId)?.type === "video"
						? videoInputSnapshot(document, nodeId)
						: null;
				const inputImageAssetId = videoInput
					? videoInputImageAssetId(
							videoInput,
							query.data?.imageResults.find(
								(run) => run.nodeId === videoInput.image?.nodeId,
							)?.assetId,
						)
					: null;
				request = {
					id: crypto.randomUUID(),
					projectId,
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
		workflow,
		runs,
		imageResults: new Map(
			(query.data?.imageResults ?? []).map((run) => [run.nodeId, run]),
		),
		imageConfigured: query.data?.imageConfigured,
		speechResults: new Map(
			(query.data?.speechResults ?? []).map((run) => [run.nodeId, run]),
		),
		speechConfigured: query.data?.speechConfigured,
		videoConfigured: query.data?.videoConfigured,
		imageToVideoConfigured: query.data?.imageToVideoConfigured,
		videoResults: new Map(
			(query.data?.videoResults ?? []).map((run) => [run.nodeId, run]),
		),
		run,
		balance: query.data?.balance,
		configured: query.data?.configured,
		loading: query.isPending,
		queryError: query.isError,
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
export function useNodeRun(id: string): PublicRun | undefined {
	return useContext(GenerationContext)?.runs.get(id);
}
export function useWorkflowStep(id: string) {
	const workflow = useContext(GenerationContext)?.workflow;
	const run = workflow?.active ?? workflow?.latest;
	return run?.steps.find((step) => step.nodeId === id);
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
	const kind =
		node.type === "image" || node.type === "speech" || node.type === "video"
			? node.type
			: "text";
	const settings = {
		video: {
			cost: videoCreditCost(node.data.duration),
			models: videoModels,
			configured: generation.videoConfigured,
			model: node.data.videoModel ?? defaultVideoModel,
			field: "videoModel",
			snapshot: videoInputSnapshot,
		},
		text: {
			cost: textCreditCost,
			models: textModels,
			configured: generation.configured,
			model: resolveTextModel(node.data.textModel),
			field: "textModel",
			snapshot: textInputSnapshot,
		},
		image: {
			cost: imageCreditCost,
			models: imageModels,
			configured: generation.imageConfigured,
			model: node.data.imageModel ?? defaultImageModel,
			field: "imageModel",
			snapshot: imageInputSnapshot,
		},
		speech: {
			cost: speechCreditCost,
			models: speechModels,
			configured: generation.speechConfigured,
			model: node.data.speechModel ?? defaultSpeechModel,
			field: "speechModel",
			snapshot: speechInputSnapshot,
		},
	}[kind];
	const { cost, configured } = settings;
	const modelItems = settings.models.map((model) => ({
		value: model.id,
		label: model.name,
	}));
	const voiceItems = speechVoices.map((voice) => ({
		value: voice.id,
		label: voice.name,
	}));
	const speechResult = generation.speechResults.get(node.id);
	const videoResult = generation.videoResults.get(node.id);
	const imageResult = generation.imageResults.get(node.id);
	const run = generation.runs.get(node.id);
	const pending = generation.pendingNode === node.id || isRunActive(run);
	const checking = generation.uncertain?.nodeId === node.id;
	let inputError: string | null = null;
	let inputImageAssetId: string | null = null;
	let imageNode: StudioNode | undefined;
	try {
		settings.snapshot(documentFromGraph(generation.graph), node.id);
		if (kind === "video") {
			const snapshot = videoInputSnapshot(
				documentFromGraph(generation.graph),
				node.id,
			);
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
				else if (!generation.imageToVideoConfigured)
					inputError =
						"Image-to-video needs a public HTTPS app URL so the provider can fetch this image.";
			}
		}
	} catch (error) {
		inputError = error instanceof Error ? error.message : "Invalid input.";
	}
	const error = pending
		? null
		: generation.error?.nodeId === node.id
			? generation.error.message
			: run?.error;
	const disabled =
		!generation.canRun ||
		generation.loading ||
		generation.queryError ||
		!configured ||
		Boolean(generation.pendingNode) ||
		(!checking &&
			(pending ||
				generation.myRunActive ||
				Boolean(generation.uncertain) ||
				(generation.balance ?? 0) < cost ||
				(!node.data.content.trim() &&
					!inputImageAssetId &&
					(kind === "text" ||
						!generation.graph.edges.some(
							(edge) =>
								edge.target === node.id &&
								edge.targetHandle === (kind === "speech" ? "script" : "prompt"),
						))) ||
				Boolean(inputError)));
	return (
		<section
			className="flex flex-col gap-4 border-t pt-4"
			aria-label={`${kind[0]?.toUpperCase()}${kind.slice(1)} generation`}
		>
			<Field>
				<FieldLabel htmlFor={`${kind}-model`}>Model</FieldLabel>
				<Select
					items={modelItems}
					value={settings.model}
					disabled={!canEdit || pending}
					onValueChange={(value) => {
						if (value) update({ [settings.field]: value }, `${kind}Model`);
					}}
				>
					<SelectTrigger id={`${kind}-model`} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{modelItems.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
				<FieldDescription>
					{cost} Kousa {cost === 1 ? "credit" : "credits"} per successful run ·{" "}
					{kind === "video"
						? `Silent MP4 · 480p · ${node.data.duration} seconds`
						: kind === "image"
							? `${imageSizes[node.data.aspectRatio].replace("x", " × ")} pixels`
							: kind === "speech"
								? "MP3 · Up to 1,000 script characters"
								: "Up to 2,048 output tokens"}
					.
				</FieldDescription>
				<FieldDescription>
					{kind === "speech" || kind === "video"
						? "Requires paid credits enabled on your Vercel AI Gateway account."
						: "Models eligible for Vercel free credits."}
				</FieldDescription>
			</Field>
			{kind === "video" && imageNode ? (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-xs">
						Starting image · {imageNode.data.label}
					</h3>
					{inputImageAssetId ? (
						<AssetPreview key={inputImageAssetId} assetId={inputImageAssetId} />
					) : null}
					<p className="text-muted-foreground text-xs">
						Uses this image node’s selected output. Add a motion prompt, or
						leave it empty to let the model animate the image.
					</p>
				</div>
			) : null}
			{kind === "speech" ? (
				<Field>
					<FieldLabel htmlFor="speech-voice">Voice</FieldLabel>
					<Select
						items={voiceItems}
						value={node.data.voiceId ?? defaultSpeechVoice}
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
						Voice direction controls delivery, such as calm or excited. Results
						can vary.
					</FieldDescription>
				</Field>
			) : null}
			{canEdit ? (
				<div className="flex flex-col gap-2">
					<Button
						disabled={disabled}
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
								: `Generate ${kind}`}
					</Button>
					<p className="text-muted-foreground text-xs">
						Your balance: {generation.balance ?? "…"} credits. Uses your
						credits.
					</p>
					{!generation.canRun ? (
						<p className="text-muted-foreground text-xs">
							Wait for the canvas to connect and finish saving.
						</p>
					) : null}
					{configured === false ? (
						<p className="text-muted-foreground text-xs">
							Generation is not available yet.
						</p>
					) : null}
					{generation.queryError ? (
						<p role="alert" className="text-destructive text-xs">
							Could not load generation status. Reconnect to try again.
						</p>
					) : null}
					{inputError ? (
						<p className="text-destructive text-xs">{inputError}</p>
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
						Uses the prompt and connected text. Connected text uses its last
						successful output, or its written text. Uploaded images are not used
						as references yet.
					</p>
					{imageResult?.assetId ? (
						<>
							<h3 className="font-medium text-xs">Last generated image</h3>
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
						or its written text, followed by this script. Run to this node
						generates connected text first.
					</p>
					{speechResult?.assetId ? (
						<>
							<h3 className="font-medium text-xs">Last generated speech</h3>
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
						Creates a silent clip from your prompt and, optionally, one
						connected image. Connected text uses its last successful output, or
						its written text. Video and audio inputs are not supported yet.
					</p>
					{videoResult?.assetId ? (
						<>
							<h3 className="font-medium text-xs">Last generated video</h3>
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
			{run?.output ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<h3 className="font-medium text-xs">Generated output</h3>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Copy generated text"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(run.output ?? "");
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
						value={run.output}
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
