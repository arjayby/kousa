"use client";

import {
	connectedOutput,
	resolveConnection,
} from "@kousa/generation/connections";
import type { CanvasConnection, CanvasDocument } from "@kousa/projects/canvas";
import { inputPorts, nodeLabels } from "@kousa/projects/canvas";
import { planConnection } from "@kousa/projects/canvas-connections";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Badge } from "@kousa/ui/components/badge";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@kousa/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kousa/ui/components/select";
import { useContext, useState } from "react";
import { GenerationContext } from "./canvas-generation";
import {
	AssetPreview,
	AudioPreview,
	useCanvasMedia,
	VideoPreview,
} from "./canvas-media";

export type ConnectionReview = {
	connection: CanvasConnection;
	reconnectId?: string;
};

export function ConnectionPreview({
	graph,
	connection,
}: {
	graph: CanvasDocument;
	connection: CanvasConnection;
}) {
	const generation = useContext(GenerationContext);
	const media = useCanvasMedia();
	const input = resolveConnection(graph, connection);
	if (!input) return <p role="alert">A connected node was removed.</p>;
	const results = {
		text: generation?.textResults,
		image: generation?.imageResults,
		audio: generation?.speechResults,
		video: generation?.videoResults,
	};
	const output = connectedOutput(
		input.source,
		results[input.source.type]?.get(input.source.id),
	);
	const waiting = !generation || generation.loading || generation.queryError;
	return (
		<section
			className="flex flex-col gap-2"
			aria-label="Connection contribution"
		>
			<p className="font-medium text-xs">
				{input.source.data.label || nodeLabels[input.source.type]} →{" "}
				{input.target.data.label || nodeLabels[input.target.type]} ·{" "}
				{inputPorts[input.target.type].find(
					(port) => port.id === connection.targetHandle,
				)?.label ?? connection.targetHandle}
			</p>
			<Badge
				variant={input.usage === "unsupported" ? "destructive" : "secondary"}
			>
				{input.usage === "composition"
					? "Composition · Create clip"
					: input.usage === "unsupported"
						? "Unsupported input"
						: `Generation · ${input.model}`}
			</Badge>
			<p className="text-muted-foreground text-xs">{input.description}</p>
			{waiting ? (
				<p role="status" className="text-muted-foreground text-xs">
					{generation?.queryError
						? "Could not load saved outputs. Reconnect to review the selected version."
						: "Loading selected output…"}
				</p>
			) : (
				<>
					<p className="text-xs">
						{output.version}
						{output.createdAt
							? ` · ${new Date(output.createdAt).toLocaleString()}`
							: ""}
					</p>
					{output.runId ? (
						<p className="break-all font-mono text-[10px] text-muted-foreground">
							Run {output.runId}
						</p>
					) : null}
					{output.assetId ? (
						<p className="break-all font-mono text-[10px] text-muted-foreground">
							Asset {output.assetId}
						</p>
					) : null}
					{output.error ? (
						<p role="status" className="text-muted-foreground text-xs">
							{output.error}
						</p>
					) : null}
					{output.text !== null ? (
						<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-xs">
							{output.text ||
								"This text is empty. Write text or generate an output before running the destination."}
						</pre>
					) : null}
					{output.assetId && input.source.type === "image" ? (
						<AssetPreview key={output.assetId} assetId={output.assetId} />
					) : null}
					{output.assetId && input.source.type === "audio" ? (
						<AudioPreview
							key={output.assetId}
							assetId={output.assetId}
							transcript={
								input.source.data.mediaSource === "project"
									? (media.assets.find((asset) => asset.id === output.assetId)
											?.transcript ?? null)
									: (results.audio?.get(input.source.id)?.transcript ?? null)
							}
						/>
					) : null}
					{output.assetId && input.source.type === "video" ? (
						<VideoPreview key={output.assetId} assetId={output.assetId} />
					) : null}
				</>
			)}
			{input.usage === "text" || input.usage === "image" ? (
				<p className="text-muted-foreground text-xs">
					Generate uses the output shown now. Run affected steps may update
					upstream outputs first. Historical selections and project assets stay
					fixed.
				</p>
			) : null}
		</section>
	);
}

function ConnectionSelect({
	id,
	label,
	value,
	items,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	items: { value: string; label: string }[];
	onChange: (value: string) => void;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={items}
				value={value || null}
				onValueChange={(value) => {
					if (value) onChange(value);
				}}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue placeholder="Choose a node" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}

export function ConnectionDialog({
	graph,
	review,
	canEdit,
	close,
	apply,
}: {
	graph: CanvasDocument;
	review: ConnectionReview;
	canEdit: boolean;
	close: () => void;
	apply: (review: ConnectionReview, expectedRemoved: string) => string | null;
}) {
	const [connection, setConnection] = useState(review.connection);
	const [saveError, setSaveError] = useState<string | null>(null);
	const plan = planConnection(graph, connection, review.reconnectId);
	const input = resolveConnection(graph, connection);
	const error =
		(connection.source
			? plan.error
			: "Choose an output node to preview this connection.") ??
		(input?.usage === "unsupported" ? input.description : null);
	const nodes = graph.nodes.map((node) => ({
		value: node.id,
		label: `${node.data.label || nodeLabels[node.type]} · ${nodeLabels[node.type]} · ${node.id.slice(0, 6)}`,
	}));
	const target = graph.nodes.find((node) => node.id === connection.target);
	const ports = target
		? inputPorts[target.type].map((port) => ({
				value: port.id,
				label: port.label,
			}))
		: [];
	const change = (patch: Partial<CanvasConnection>) => {
		setConnection((value) => ({ ...value, ...patch }));
		setSaveError(null);
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{review.reconnectId
							? "Reconnect nodes"
							: plan.occupied
								? "Replace input connection"
								: "Preview connection"}
					</DialogTitle>
					<DialogDescription>
						Review what this connection contributes. Connecting uses no credits.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<ConnectionSelect
						id="connection-source"
						label="From output"
						value={connection.source}
						items={nodes}
						onChange={(source) => change({ source })}
					/>
					<ConnectionSelect
						id="connection-target"
						label="To node"
						value={connection.target}
						items={nodes}
						onChange={(target) => {
							const node = graph.nodes.find((node) => node.id === target);
							change({
								target,
								targetHandle: node ? (inputPorts[node.type][0]?.id ?? "") : "",
							});
						}}
					/>
					<ConnectionSelect
						id="connection-port"
						label="Input"
						value={connection.targetHandle}
						items={ports}
						onChange={(targetHandle) => change({ targetHandle })}
					/>
				</FieldGroup>
				{input ? (
					<ConnectionPreview graph={graph} connection={connection} />
				) : null}
				{plan.occupied ? (
					<Alert>
						<AlertTitle>Replace occupied input</AlertTitle>
						<AlertDescription>
							The connection from{" "}
							{graph.nodes.find((node) => node.id === plan.occupied?.source)
								?.data.label || "the previous source"}{" "}
							will be replaced. Undo restores both connections to their previous
							state.
						</AlertDescription>
					</Alert>
				) : null}
				{error || saveError ? (
					<Alert variant="destructive">
						<AlertTitle>Cannot connect</AlertTitle>
						<AlertDescription>{saveError ?? error}</AlertDescription>
					</Alert>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={close}>
						Cancel
					</Button>
					<Button
						disabled={!canEdit || !!error}
						onClick={() => {
							const error = apply(
								{ connection, reconnectId: review.reconnectId },
								JSON.stringify(plan.removed),
							);
							if (error) setSaveError(error);
							else close();
						}}
					>
						{review.reconnectId
							? "Apply reconnection"
							: plan.occupied
								? "Replace connection"
								: "Connect nodes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
