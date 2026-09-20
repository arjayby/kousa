"use client";

import type { PublicAsset } from "@kousa/media/contracts";
import {
	aspectRatios,
	type CanvasConnection,
	type CanvasNode,
	inputPorts,
	nodeLabels,
} from "@kousa/projects/canvas";
import type { createCanvasDocumentModel } from "@kousa/projects/canvas-document";
import { Button } from "@kousa/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import { CopyIcon, Trash2Icon, UnplugIcon, XIcon } from "lucide-react";
import { ClipPanel } from "./canvas-clips";
import { GenerationPanel, useNodeImage } from "./canvas-generation";
import { ImageMediaPanel } from "./canvas-media";
import { ConnectionPreview } from "./connection-preview";
import { type ApplyHistory, GenerationHistory } from "./generation-history";
import { ImageLayoutPanel } from "./image-layout-panel";
import { nodeIcons } from "./media-node";
import { SharedTextField } from "./shared-text-field";
import { StoredMediaPanel } from "./stored-media-panel";
import type { StudioEdge, StudioNode } from "./use-canvas";
import { documentFromGraph } from "./use-canvas";

export function NodeInspector({
	node,
	nodes,
	edges,
	canEdit,
	model,
	update,
	endEdit,
	remove,
	duplicate,
	applyHistory,
	addImage,
	disconnect,
	reviewConnection,
	close,
}: {
	node: StudioNode;
	nodes: StudioNode[];
	edges: StudioEdge[];
	canEdit: boolean;
	model: ReturnType<typeof createCanvasDocumentModel> | null;
	update: (data: Partial<CanvasNode["data"]>, field: string) => void;
	endEdit: () => void;
	remove: () => void;
	duplicate: () => void;
	applyHistory: ApplyHistory;
	addImage: (asset: PublicAsset) => boolean;
	disconnect: (id: string) => void;
	reviewConnection: (
		connection: CanvasConnection,
		reconnectId?: string,
	) => void;
	close: () => void;
}) {
	const imageResult = useNodeImage(node.id);
	const graph = documentFromGraph({ nodes, edges });
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
				{kind === "image" ? (
					<ImageLayoutPanel
						key={`layout-${node.id}`}
						node={node}
						generatedAssetId={imageResult?.assetId}
						canEdit={canEdit}
						apply={applyHistory}
						addImage={addImage}
					/>
				) : null}
				<GenerationHistory
					key={`history:${node.id}`}
					node={node}
					apply={applyHistory}
				/>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="node-label">Name</FieldLabel>
						{model ? (
							<SharedTextField
								key={`${node.id}:label`}
								model={model}
								nodeId={node.id}
								field="label"
								id="node-label"
								maxLength={80}
								readOnly={!canEdit}
								onBlur={endEdit}
							/>
						) : null}
					</Field>
					<Field>
						<FieldLabel htmlFor="node-content">
							{kind === "speech"
								? "Script"
								: kind === "text"
									? "Text / prompt"
									: "Prompt"}
						</FieldLabel>
						{model ? (
							<SharedTextField
								key={`${node.id}:content`}
								model={model}
								nodeId={node.id}
								field="content"
								multiline
								id="node-content"
								className="min-h-40 resize-y"
								maxLength={20_000}
								readOnly={!canEdit}
								placeholder={
									kind === "speech"
										? "What should the voice say?"
										: "Describe your idea…"
								}
								onBlur={endEdit}
							/>
						) : null}
						<FieldDescription>
							{kind === "text"
								? "Connect this output to a prompt or script input."
								: kind === "image"
									? "Write a prompt here, connect a Text node, or use both."
									: kind === "speech"
										? "Write the words to speak, connect a Text node, or use both."
										: "Describe a scene and its motion, or connect an Image node and add optional motion instructions. You can also connect Text."}
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
							{model ? (
								<SharedTextField
									key={`${node.id}:voiceDirection`}
									model={model}
									nodeId={node.id}
									field="voiceDirection"
									id="voice-direction"
									maxLength={500}
									readOnly={!canEdit}
									placeholder="Warm, calm, conversational…"
									onBlur={endEdit}
								/>
							) : null}
						</Field>
					) : null}
				</FieldGroup>
				{kind === "video" || kind === "speech" ? (
					<StoredMediaPanel
						key={node.id}
						node={node}
						canEdit={canEdit}
						update={update}
					/>
				) : null}
				{kind === "video" ? (
					<ClipPanel node={node} canEdit={canEdit} update={update} />
				) : null}
				<section className="flex flex-col gap-4" aria-label="Node connections">
					<h3 className="font-medium text-xs">
						Connections · {attached.length}
					</h3>
					<p className="text-muted-foreground text-xs">
						Upstream nodes have a solid outline. Downstream nodes have a dashed
						outline. Dashed connections carry audio for composition.
					</p>
					{inputPorts[kind].map((port) => {
						const edge = edges.find(
							(edge) =>
								edge.target === node.id && edge.targetHandle === port.id,
						);
						return (
							<div key={port.id} className="flex flex-col gap-2">
								<h4 className="font-medium text-xs">{port.label} input</h4>
								{edge ? (
									<ConnectionPreview graph={graph} connection={edge} />
								) : (
									<p className="text-muted-foreground text-xs">
										{kind === "image" && port.id === "reference"
											? "Connect an Image to edit an uploaded photo or a saved output. Describe your changes in the prompt."
											: kind === "video" && port.id === "video"
												? "Video-to-video is not supported by the current generator."
												: kind === "video" && port.id === "audio"
													? "Speech is used by Create clip for composition only."
													: kind === "text"
														? "The current generator consumes Text context only."
														: `Connect ${port.accepts.map((kind) => nodeLabels[kind]).join(" or ")}.`}
									</p>
								)}
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										disabled={!canEdit}
										onClick={() =>
											reviewConnection(
												edge ?? {
													source: "",
													target: node.id,
													sourceHandle: "output",
													targetHandle: port.id,
												},
												edge?.id,
											)
										}
									>
										{edge
											? `Change ${port.label} connection`
											: `Connect ${port.label}`}
									</Button>
									{edge ? (
										<Button
											variant="ghost"
											size="icon-sm"
											disabled={!canEdit}
											aria-label={`Disconnect ${port.label}`}
											onClick={() => disconnect(edge.id)}
										>
											<UnplugIcon />
										</Button>
									) : null}
								</div>
							</div>
						);
					})}
					{attached
						.filter((edge) => edge.source === node.id)
						.map((edge) => (
							<div key={edge.id} className="flex flex-col gap-2">
								<h4 className="font-medium text-xs">
									Downstream ·{" "}
									{nodes.find((node) => node.id === edge.target)?.data.label ||
										"Node"}{" "}
									· {edge.targetHandle}
								</h4>
								<Button
									variant="outline"
									size="sm"
									onClick={() => reviewConnection(edge, edge.id)}
								>
									{canEdit ? "Preview or reconnect" : "Preview connection"}
								</Button>
							</div>
						))}
				</section>
				<GenerationPanel node={node} canEdit={canEdit} update={update} />
				{kind === "image" ? (
					<ImageMediaPanel
						generatedAssetId={imageResult?.assetId}
						key={node.id}
						node={node}
						canEdit={canEdit}
						update={update}
					/>
				) : null}
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
					Changes are disabled.
				</p>
			)}
		</aside>
	);
}
