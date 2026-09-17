"use client";

import {
	type PublicRun,
	resolveTextModel,
	textModels,
} from "@kousa/generation/contracts";
import { textInputHash, textInputSnapshot } from "@kousa/generation/input";
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
	const nodeIds = graph.nodes
		.filter((n) => n.type === "text")
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
			request ??= {
				id: crypto.randomUUID(),
				projectId,
				nodeId,
				inputHash: await textInputHash(documentFromGraph(graph), nodeId),
			};
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
			]);
		}
	}
	return {
		runs,
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
		myRunActive: (query.data?.runs ?? []).some(
			(r) => r.userId === userId && r.status === "running",
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

const modelItems = textModels.map((model) => ({
	value: model.id,
	label: model.name,
}));
export function TextGenerationPanel({
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
	const run = generation.runs.get(node.id);
	const pending =
		generation.pendingNode === node.id || run?.status === "running";
	const checking = generation.uncertain?.nodeId === node.id;
	let inputError: string | null = null;
	try {
		textInputSnapshot(documentFromGraph(generation.graph), node.id);
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
		!generation.configured ||
		Boolean(generation.pendingNode) ||
		(!checking &&
			(pending ||
				generation.myRunActive ||
				Boolean(generation.uncertain) ||
				(generation.balance ?? 0) < 1 ||
				!node.data.content.trim() ||
				Boolean(inputError)));
	return (
		<section
			className="flex flex-col gap-4 border-t pt-4"
			aria-label="Text generation"
		>
			<Field>
				<FieldLabel htmlFor="text-model">Model</FieldLabel>
				<Select
					items={modelItems}
					value={resolveTextModel(node.data.textModel)}
					disabled={!canEdit || pending}
					onValueChange={(value) => {
						if (value) update({ textModel: value }, "textModel");
					}}
				>
					<SelectTrigger id="text-model" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{modelItems.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<FieldDescription>
					1 Kousa credit per successful run · Up to 2,048 output tokens.
				</FieldDescription>
				<FieldDescription>
					Models eligible for Vercel free credits.
				</FieldDescription>
			</Field>
			{canEdit ? (
				<div className="flex flex-col gap-2">
					<Button
						disabled={disabled}
						onClick={() => void generation.run(node.id)}
					>
						{pending ? (
							<LoaderCircleIcon
								data-icon="inline-start"
								className="animate-spin"
							/>
						) : (
							<PlayIcon data-icon="inline-start" />
						)}
						{checking ? "Check run" : pending ? "Generating…" : "Generate text"}
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
					{generation.configured === false ? (
						<p className="text-muted-foreground text-xs">
							Text generation is not available yet.
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
			{pending ? (
				<p role="status" className="text-muted-foreground text-xs">
					Generating text… The result will appear here.
				</p>
			) : null}
			{error ? (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
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
