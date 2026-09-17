"use client";

import {
	aspectRatios,
	type CanvasNode,
	inputPorts,
	nodeLabels,
} from "@kousa/projects/canvas";
import { Button } from "@kousa/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { Textarea } from "@kousa/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import { CopyIcon, Trash2Icon, UnplugIcon, XIcon } from "lucide-react";
import { nodeIcons } from "./media-node";
import type { StudioEdge, StudioNode } from "./use-canvas";

export function NodeInspector({
	node,
	nodes,
	edges,
	canEdit,
	update,
	endEdit,
	remove,
	duplicate,
	disconnect,
	close,
}: {
	node: StudioNode;
	nodes: StudioNode[];
	edges: StudioEdge[];
	canEdit: boolean;
	update: (data: Partial<CanvasNode["data"]>, field: string) => void;
	endEdit: () => void;
	remove: () => void;
	duplicate: () => void;
	disconnect: (id: string) => void;
	close: () => void;
}) {
	const kind = node.type ?? "text";
	const Icon = nodeIcons[kind];
	const attached = edges.filter(
		(edge) => edge.source === node.id || edge.target === node.id,
	);
	return (
		<aside aria-label="Node settings" className="studio-inspector">
			<header className="flex items-center gap-2 border-b px-4 py-3">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				<h2 className="flex-1 font-medium text-sm">
					{nodeLabels[kind]} settings
				</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={close}
					aria-label="Close node settings"
				>
					<XIcon />
				</Button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="node-label">Name</FieldLabel>
						<Input
							id="node-label"
							value={node.data.label}
							maxLength={80}
							readOnly={!canEdit}
							onChange={(event) =>
								update({ label: event.target.value }, "label")
							}
							onBlur={endEdit}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="node-content">
							{kind === "speech"
								? "Script"
								: kind === "text"
									? "Text / prompt"
									: "Prompt"}
						</FieldLabel>
						<Textarea
							id="node-content"
							className="min-h-40 resize-y"
							value={node.data.content}
							maxLength={20_000}
							readOnly={!canEdit}
							placeholder={
								kind === "speech"
									? "What should the voice say?"
									: "Describe your idea…"
							}
							onChange={(event) =>
								update({ content: event.target.value }, "content")
							}
							onBlur={endEdit}
						/>
						<FieldDescription>
							{kind === "text"
								? "Connect this output to a prompt or script input."
								: "Connected inputs will supply context when generation is added."}
						</FieldDescription>
					</Field>
					{kind === "image" || kind === "video" ? (
						<Field>
							<FieldLabel>Aspect ratio</FieldLabel>
							<ToggleGroup
								variant="outline"
								size="sm"
								disabled={!canEdit}
								value={[node.data.aspectRatio]}
								onValueChange={(values) => {
									const value = aspectRatios.find(
										(ratio) => ratio === values[0],
									);
									if (value) update({ aspectRatio: value }, "aspectRatio");
								}}
								aria-label="Aspect ratio"
							>
								{aspectRatios.map((ratio) => (
									<ToggleGroupItem key={ratio} value={ratio}>
										{ratio}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						</Field>
					) : null}
					{kind === "video" ? (
						<Field>
							<FieldLabel>Duration</FieldLabel>
							<ToggleGroup
								variant="outline"
								size="sm"
								disabled={!canEdit}
								value={[String(node.data.duration)]}
								onValueChange={(values) => {
									if (values[0] === "5" || values[0] === "10")
										update(
											{ duration: values[0] === "5" ? 5 : 10 },
											"duration",
										);
								}}
								aria-label="Video duration"
							>
								<ToggleGroupItem value="5">5 seconds</ToggleGroupItem>
								<ToggleGroupItem value="10">10 seconds</ToggleGroupItem>
							</ToggleGroup>
						</Field>
					) : null}
					{kind === "speech" ? (
						<Field>
							<FieldLabel htmlFor="voice-direction">Voice direction</FieldLabel>
							<Input
								id="voice-direction"
								value={node.data.voiceDirection}
								maxLength={500}
								readOnly={!canEdit}
								placeholder="Warm, calm, conversational…"
								onChange={(event) =>
									update(
										{ voiceDirection: event.target.value },
										"voiceDirection",
									)
								}
								onBlur={endEdit}
							/>
						</Field>
					) : null}
				</FieldGroup>
				<section className="flex flex-col gap-3" aria-label="Node connections">
					<h3 className="font-medium text-xs">
						Connections{" "}
						<span className="text-muted-foreground">{attached.length}</span>
					</h3>
					{attached.length === 0 ? (
						<p className="text-muted-foreground text-xs leading-relaxed">
							Drag an output dot to a compatible input dot. You can also click
							each dot in turn.
						</p>
					) : (
						attached.map((edge) => {
							const incoming = edge.target === node.id;
							const other = nodes.find(
								(n) => n.id === (incoming ? edge.source : edge.target),
							);
							const target = nodes.find((n) => n.id === edge.target);
							const input = inputPorts[target?.type ?? "text"].find(
								(port) => port.id === edge.targetHandle,
							)?.label;
							return (
								<div
									className="flex items-center gap-2 border p-2"
									key={edge.id}
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-xs">
											{other?.data.label || nodeLabels[other?.type ?? "text"]}
										</p>
										<p className="text-[10px] text-muted-foreground">
											{incoming ? "Into" : "Out to"} {input}
										</p>
									</div>
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={!canEdit}
										aria-label={`Disconnect ${other?.data.label || "node"}`}
										onClick={() => disconnect(edge.id)}
									>
										<UnplugIcon />
									</Button>
								</div>
							);
						})
					)}
				</section>
			</div>
			{canEdit ? (
				<footer className="flex gap-2 border-t p-3">
					<Button variant="outline" className="flex-1" onClick={duplicate}>
						<CopyIcon data-icon="inline-start" />
						Duplicate
					</Button>
					<Button
						variant="destructive"
						onClick={remove}
						aria-label="Delete node"
					>
						<Trash2Icon data-icon="inline-start" />
						Delete
					</Button>
				</footer>
			) : (
				<p className="border-t p-4 text-muted-foreground text-xs">
					Viewer access. Changes are disabled.
				</p>
			)}
		</aside>
	);
}
