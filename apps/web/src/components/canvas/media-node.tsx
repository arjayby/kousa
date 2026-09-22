"use client";

import { runProgress } from "@kousa/generation/contracts";
import {
	imageOutputAssetId,
	inputPorts,
	nodeLabels,
} from "@kousa/projects/canvas";
import { Badge } from "@kousa/ui/components/badge";
import { cn } from "@kousa/ui/lib/utils";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
	AudioLinesIcon,
	FileTextIcon,
	ImageIcon,
	VideoIcon,
} from "lucide-react";
import { memo } from "react";
import { clipStatusLabels, useNodeClip } from "./canvas-clips";
import {
	useNodeFreshness,
	useNodeImage,
	useNodeRun,
	useNodeSpeech,
	useNodeText,
	useNodeVideo,
	useWorkflowStep,
} from "./canvas-generation";
import {
	AssetPreview,
	AudioPreview,
	useCanvasMedia,
	VideoPreview,
} from "./canvas-media";
import type { StudioNode } from "./use-canvas";

export const nodeIcons = {
	text: FileTextIcon,
	image: ImageIcon,
	video: VideoIcon,
	audio: AudioLinesIcon,
};
export const nodeDescriptions = {
	text: "Prompts, ideas, and scripts",
	image: "Visuals and image references",
	video: "Scenes and moving images",
	audio: "Speech, music, and sound effects",
};
const placeholders = {
	text: "Write a prompt or bring an idea to life.",
	image: "Describe the image you want to create.",
	video: "Describe a scene and how it moves.",
	audio: "Generate speech or upload music and sound effects.",
};

export const MediaNode = memo(function MediaNode({
	id,
	type,
	data,
	selected,
	isConnectable,
}: NodeProps<StudioNode>) {
	const kind = type ?? "text";
	const run = useNodeRun(id);
	const freshness = useNodeFreshness(id);
	const textResult = useNodeText(id);
	const workflowStep = useWorkflowStep(id);
	const imageResult = useNodeImage(id);
	const speechResult = useNodeSpeech(id);
	const videoResult = useNodeVideo(id);
	const clip = useNodeClip(id);
	const media = useCanvasMedia();
	const sourceVideoAssetId =
		data.mediaSource === "project" ? data.assetId : videoResult?.assetId;
	const videoAssetId =
		!data.selectedRunId && clip.result?.plan.videoAssetId === sourceVideoAssetId
			? (clip.result?.assetId ?? sourceVideoAssetId)
			: sourceVideoAssetId;
	const speechAssetId =
		data.mediaSource === "project" ? data.assetId : speechResult?.assetId;
	const assetId = imageOutputAssetId(data, imageResult?.assetId);
	const Icon = nodeIcons[kind];
	return (
		<div
			className={cn("studio-node", selected && "studio-node-selected")}
			data-kind={kind}
		>
			<div className="studio-node-header">
				<span className="studio-node-icon">
					<Icon className="size-4" aria-hidden="true" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{data.label || nodeLabels[kind]}
					</p>
					<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
						{nodeLabels[kind]}
					</p>
				</div>
			</div>
			<div className="studio-node-body">
				{freshness?.runId &&
				(kind === "text" ||
					(data.imageSource !== "project" &&
						data.mediaSource !== "project")) ? (
					<Badge variant="outline" className="mb-2" title={freshness.reason}>
						{freshness.state === "current"
							? "Up to date"
							: freshness.state === "blocked"
								? "Blocked"
								: "Outdated"}
					</Badge>
				) : null}
				{data.selectedRunId ? (
					<p className="mb-2 text-muted-foreground text-xs">
						Historical output selected
					</p>
				) : null}
				{kind === "video" && clip.run ? (
					<p className="mb-2 text-muted-foreground text-xs">
						Clip · {clipStatusLabels[clip.run.status]}
					</p>
				) : null}
				{workflowStep ? (
					<p className="mb-2 text-[10px] text-muted-foreground">
						Workflow ·{" "}
						{workflowStep.reused
							? "Reused"
							: workflowStep.status === "succeeded"
								? "Complete"
								: workflowStep.status === "running"
									? "Generating"
									: workflowStep.status === "failed"
										? "Failed"
										: workflowStep.status === "cancelled"
											? "Cancelled"
											: workflowStep.status === "blocked"
												? "Blocked"
												: "Waiting"}
					</p>
				) : null}
				{kind === "image" && assetId ? (
					<AssetPreview key={assetId} assetId={assetId} compact />
				) : null}
				{kind === "video" && videoAssetId ? (
					<VideoPreview key={videoAssetId} assetId={videoAssetId} compact />
				) : null}
				{kind === "audio" && speechAssetId ? (
					<AudioPreview
						key={speechAssetId}
						assetId={speechAssetId}
						transcript={
							data.mediaSource === "project"
								? (media.assets.find((asset) => asset.id === speechAssetId)
										?.transcript ?? null)
								: (speechResult?.transcript ?? null)
						}
						compact
					/>
				) : null}
				{run ? (
					<p className="mb-2 text-[10px] text-muted-foreground">
						{runProgress(run) ??
							(run.status === "succeeded"
								? kind === "image" && assetId !== imageResult?.assetId
									? "Generated image saved"
									: "Generated output"
								: "Generation failed · Credits released")}
					</p>
				) : null}
				{textResult?.output || data.content ? (
					<p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed">
						{textResult?.output ?? data.content}
					</p>
				) : (kind === "image" && assetId) ||
					(kind === "video" && videoAssetId) ||
					(kind === "audio" && speechAssetId) ? null : (
					<div className="flex flex-col items-center gap-2 py-3 text-center text-muted-foreground">
						<Icon className="size-6 opacity-50" aria-hidden="true" />
						<p className="max-w-44 text-xs leading-relaxed">
							{placeholders[kind]}
						</p>
					</div>
				)}
			</div>
			{kind === "image" || kind === "video" ? (
				<div className="flex gap-2 px-4 pb-3 font-mono text-[10px] text-muted-foreground">
					<span>{data.aspectRatio}</span>
					{kind === "video" ? <span>· {data.duration}s</span> : null}
				</div>
			) : null}
			<div className="studio-node-ports">
				{inputPorts[kind].map((port, index) => (
					<div className="studio-port-row" key={port.id}>
						<Handle
							id={port.id}
							type="target"
							position={Position.Left}
							isConnectable={isConnectable}
							style={{ top: "50%" }}
							aria-label={`${data.label || nodeLabels[kind]} ${port.label} input`}
							title={`${port.label}: ${port.accepts.map((t) => nodeLabels[t]).join(", ")}`}
						/>
						<span>
							{port.label}
							{kind === "video" && port.id === "audio"
								? " · Composition"
								: kind === "video" && port.id === "video"
									? " · Unsupported"
									: kind === "text"
										? " · Text only"
										: ""}
						</span>
						{index === 0 ? (
							<>
								<span className="ml-auto">{nodeLabels[kind]}</span>
								<Handle
									id="output"
									type="source"
									position={Position.Right}
									isConnectable={isConnectable}
									style={{ top: "50%" }}
									aria-label={`${data.label || nodeLabels[kind]} output`}
									title={`${nodeLabels[kind]} output`}
								/>
							</>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
});
