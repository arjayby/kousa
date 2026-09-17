"use client";

import { inputPorts, nodeLabels } from "@kousa/projects/canvas";
import { cn } from "@kousa/ui/lib/utils";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { FileTextIcon, ImageIcon, MicIcon, VideoIcon } from "lucide-react";
import { memo } from "react";
import { useNodeRun } from "./canvas-generation";
import type { StudioNode } from "./use-canvas";

export const nodeIcons = {
	text: FileTextIcon,
	image: ImageIcon,
	video: VideoIcon,
	speech: MicIcon,
};
export const nodeDescriptions = {
	text: "Prompts, ideas, and scripts",
	image: "Visuals and image references",
	video: "Scenes and moving images",
	speech: "Voiceovers and narration",
};
const placeholders = {
	text: "Write a prompt or bring an idea to life.",
	image: "Describe the image you want to create.",
	video: "Describe a scene and how it moves.",
	speech: "Write the words you want to hear.",
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
				{run ? (
					<p className="mb-2 text-[10px] text-muted-foreground">
						{run.status === "running"
							? "Generating…"
							: run.status === "succeeded"
								? "Generated output"
								: "Generation failed · Credit released"}
					</p>
				) : null}
				{run?.output || data.content ? (
					<p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed">
						{run?.output ?? data.content}
					</p>
				) : (
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
						<span>{port.label}</span>
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
