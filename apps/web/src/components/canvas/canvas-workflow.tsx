"use client";

import { speechVoices } from "@kousa/generation/contracts";
import { planGraph } from "@kousa/generation/graph-plan";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon, WorkflowIcon } from "lucide-react";
import { useRef, useState } from "react";
import { client, orpc } from "@/utils/orpc";
import { documentFromGraph, type StudioGraph } from "./use-canvas";

type Estimate = Awaited<ReturnType<typeof client.graph.preview>>;
type Request = Parameters<typeof client.graph.start>[0];

export function useGraphRuns({
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
	const query = useQuery({
		...orpc.graph.list.queryOptions({ input: { projectId, canvasId } }),
		queryKey: ["graph-runs", userId, projectId, canvasId, "multiple-outputs"],
		enabled: loaded,
		refetchInterval: 3_000,
		retry: false,
	});
	const [preview, setPreview] = useState<{
		request: Request;
		estimate: Estimate;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const busy = useRef(false);
	const onStarted = useRef<(() => void) | undefined>(undefined);
	const active = query.data?.runs.find((run) => run.status === "running");
	async function review(
		target: string | string[],
		resumeOf?: string,
		onStart?: () => void,
		mode: "affected" | "force" = "affected",
	) {
		if (!canRun || busy.current || uncertain || active) return false;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			const targets =
				typeof target === "string" ? { nodeId: target } : { nodeIds: target };
			const inputHash = resumeOf
				? undefined
				: (await planGraph(documentFromGraph(graph), target)).inputHash;
			const estimate = await client.graph.preview({
				projectId,
				canvasId,
				...targets,
				mode,
				resumeOf,
				inputHash,
			});
			onStarted.current = onStart;
			setPreview({
				estimate,
				request: {
					id: crypto.randomUUID(),
					projectId,
					canvasId,
					...targets,
					mode,
					resumeOf,
					inputHash: estimate.inputHash,
				},
			});
			setUncertain(false);
			return true;
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not preview this workflow.",
			);
			return false;
		} finally {
			busy.current = false;
			setPending(false);
		}
	}
	async function start() {
		if (!preview || !canRun || busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await client.graph.start(preview.request);
			onStarted.current?.();
			setPreview(null);
			setUncertain(false);
		} catch (cause) {
			const code =
				cause && typeof cause === "object" && "code" in cause
					? String(cause.code)
					: "";
			const definitive = [
				"BAD_REQUEST",
				"FORBIDDEN",
				"NOT_FOUND",
				"UNAUTHORIZED",
				"CONFLICT",
				"PAYMENT_REQUIRED",
				"SERVICE_UNAVAILABLE",
			].includes(code);
			setUncertain(!definitive);
			setError(
				definitive && cause instanceof Error
					? cause.message
					: "Connection interrupted. Check this workflow before starting another.",
			);
		} finally {
			busy.current = false;
			setPending(false);
			await Promise.allSettled([
				cache.invalidateQueries({
					queryKey: ["graph-runs", userId, projectId],
				}),
				cache.invalidateQueries({
					queryKey: ["generation", userId, projectId],
				}),
				cache.invalidateQueries({ queryKey: ["credits", userId] }),
			]);
		}
	}
	return {
		userId,
		runs: query.data?.runs ?? [],
		active,
		latest: query.data?.runs[0],
		configured: query.data?.configured,
		queryError: query.isError,
		loading: query.isPending,
		preview,
		error,
		pending,
		uncertain,
		review,
		changeMode: (mode: "affected" | "force") =>
			preview &&
			review(
				preview.estimate.targetNodeIds,
				undefined,
				onStarted.current,
				mode,
			),
		start,
		canRun,
		closePreview: () => {
			if (!pending && !uncertain) {
				setPreview(null);
				setError(null);
			}
		},
	};
}
export type Workflow = ReturnType<typeof useGraphRuns>;

export function WorkflowControls({
	workflow,
	nodeId,
	canEdit,
	onStart,
}: {
	workflow: Workflow;
	nodeId: string;
	canEdit: boolean;
	onStart?: () => void;
}) {
	if (!canEdit) return null;
	return (
		<div className="flex flex-col gap-2">
			<Button
				variant="outline"
				disabled={
					!workflow.canRun ||
					!workflow.configured ||
					workflow.loading ||
					workflow.queryError ||
					workflow.pending ||
					!!workflow.active ||
					workflow.uncertain
				}
				onClick={() => void workflow.review(nodeId, undefined, onStart)}
			>
				<WorkflowIcon data-icon="inline-start" />
				Run affected steps
			</Button>
			<p className="text-muted-foreground text-xs">
				Update this node and its affected inputs. Unchanged results are reused
				at no charge.
			</p>
		</div>
	);
}

export function WorkflowMonitor({ workflow }: { workflow: Workflow }) {
	return (
		<>
			{workflow.error && !workflow.preview ? (
				<p role="alert" className="text-destructive text-xs">
					{workflow.error}
				</p>
			) : null}
			<Dialog
				open={!!workflow.preview}
				onOpenChange={(open) => {
					if (!open) workflow.closePreview();
				}}
			>
				<DialogContent
					className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
					showCloseButton={!workflow.pending && !workflow.uncertain}
				>
					<DialogHeader>
						<DialogTitle>
							{workflow.preview?.request.resumeOf
								? "Resume workflow"
								: workflow.preview?.request.mode === "force"
									? "Force regenerate workflow"
									: "Run affected steps"}
						</DialogTitle>
						<DialogDescription>
							{workflow.preview?.request.resumeOf
								? "Continue the original saved prompts and settings. Completed steps are reused at no extra charge."
								: workflow.preview?.request.mode === "force"
									? "Every listed step generates a new result. Selected historical inputs remain fixed."
									: "Only affected steps generate new results. Unchanged results and selected historical inputs are reused at no charge."}
						</DialogDescription>
					</DialogHeader>
					<p className="text-muted-foreground text-xs">
						{workflow.preview?.estimate.targetNodeIds.length} selected{" "}
						{workflow.preview?.estimate.targetNodeIds.length === 1
							? "output"
							: "outputs"}{" "}
						· {workflow.preview?.estimate.steps.length} steps. Steps run one at
						a time in dependency order. A failure stops the workflow; resume to
						continue its unfinished branches.
					</p>
					{!workflow.preview?.request.resumeOf ? (
						<Button
							variant="outline"
							size="sm"
							disabled={workflow.pending || workflow.uncertain}
							onClick={() =>
								void workflow.changeMode(
									workflow.preview?.request.mode === "force"
										? "affected"
										: "force",
								)
							}
						>
							{workflow.preview?.request.mode === "force"
								? "Use unchanged results"
								: "Force regenerate all steps"}
						</Button>
					) : null}
					<ol className="flex max-h-64 flex-col gap-2 overflow-y-auto">
						{workflow.preview?.estimate.steps.map((step, index) => (
							<li
								key={step.nodeId}
								className="flex justify-between gap-3 text-sm"
							>
								<span className="min-w-0 break-words">
									{index + 1}. {step.label || step.kind}
									{step.isOutput ? (
										<Badge variant="outline" className="ml-2">
											Output
										</Badge>
									) : null}
									<span className="mt-1 block text-muted-foreground text-xs">
										{step.blocker ?? step.reason}
									</span>
									{step.speech ? (
										<span className="mt-1 block text-muted-foreground text-xs">
											Voice:{" "}
											{speechVoices.find(
												(voice) => voice.id === step.speech?.voiceId,
											)?.name ?? step.speech.voiceId}
											{step.speech.voiceDirection
												? ` · ${step.speech.voiceDirection}`
												: ""}
										</span>
									) : null}
									{step.imageInput ? (
										<span className="mt-1 block text-muted-foreground text-xs">
											{step.imageInput === "history"
												? "Uses the selected historical image. No image generation charge."
												: step.imageInput === "project"
													? "Uses the selected project image. No image generation charge."
													: workflow.preview?.request.resumeOf
														? "Uses the image from this saved workflow, reusing it if already completed."
														: "Uses this workflow’s exact image output, reusing it when unchanged."}
										</span>
									) : null}
								</span>
								<span className="shrink-0 text-muted-foreground">
									{step.blocker
										? "Blocked"
										: step.reused
											? "Reuse · 0 credits"
											: `Regenerate · ${step.credits} ${step.credits === 1 ? "credit" : "credits"}`}
								</span>
							</li>
						))}
					</ol>
					{workflow.preview?.estimate.steps.some(
						(step) => step.kind === "speech" && !step.reused,
					) ? (
						<p className="text-muted-foreground text-xs">
							Speech reads this workflow's text outputs and the node's script
							verbatim, up to 1,000 characters combined. It requires paid
							credits enabled on your Vercel AI Gateway account.
						</p>
					) : null}
					{workflow.preview?.estimate.steps.some(
						(step) => step.kind === "video" && !step.reused,
					) ? (
						<p className="text-muted-foreground text-xs">
							Video requires paid credits enabled on your Vercel AI Gateway
							account.
						</p>
					) : null}
					{workflow.preview?.estimate.blockers.map((blocker) => (
						<p key={blocker} role="alert" className="text-destructive text-sm">
							{blocker}
						</p>
					))}
					<p className="text-sm">
						Reservation:{" "}
						<strong>
							{workflow.preview?.estimate.blockers.length
								? 0
								: workflow.preview?.estimate.credits}{" "}
							credits
						</strong>{" "}
						· Your balance: {workflow.preview?.estimate.balance}
					</p>
					{workflow.preview?.estimate.credits === 0 ? (
						<p className="text-muted-foreground text-sm">
							All results are up to date. No generation is needed.
						</p>
					) : null}
					<p className="text-muted-foreground text-xs">
						Uses your credits. Failed and blocked steps are refunded. You can
						close the tab while it runs.
					</p>
					{workflow.error ? (
						<p role="alert" className="text-destructive text-sm">
							{workflow.error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							variant="outline"
							disabled={workflow.pending || workflow.uncertain}
							onClick={workflow.closePreview}
						>
							Cancel
						</Button>
						<Button
							disabled={
								workflow.pending ||
								!workflow.canRun ||
								(!workflow.uncertain &&
									workflow.preview?.estimate.credits === 0) ||
								(!workflow.uncertain &&
									Boolean(workflow.preview?.estimate.blockers.length)) ||
								(!workflow.uncertain &&
									(workflow.preview?.estimate.balance ?? 0) <
										(workflow.preview?.estimate.credits ?? 0))
							}
							onClick={() => void workflow.start()}
						>
							{workflow.pending ? (
								<LoaderCircleIcon
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : null}
							{workflow.uncertain
								? "Check workflow"
								: workflow.preview?.request.resumeOf
									? "Resume workflow"
									: "Start workflow"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
