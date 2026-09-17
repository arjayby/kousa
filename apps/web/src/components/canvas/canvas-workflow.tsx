"use client";

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

type Run = Awaited<ReturnType<typeof client.graph.list>>["runs"][number];
type Estimate = Awaited<ReturnType<typeof client.graph.preview>>;
type Request = Parameters<typeof client.graph.start>[0];

export function useGraphRuns({
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
	const query = useQuery({
		...orpc.graph.list.queryOptions({ input: { projectId } }),
		queryKey: ["graph-runs", userId, projectId],
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
		nodeId: string,
		resumeOf?: string,
		onStart?: () => void,
	) {
		if (!canRun || busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			const inputHash = resumeOf
				? undefined
				: (await planGraph(documentFromGraph(graph), nodeId)).inputHash;
			const estimate = await client.graph.preview({
				projectId,
				nodeId,
				resumeOf,
				inputHash,
			});
			onStarted.current = onStart;
			setPreview({
				estimate,
				request: {
					id: crypto.randomUUID(),
					projectId,
					nodeId,
					resumeOf,
					inputHash: estimate.inputHash,
				},
			});
			setUncertain(false);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not preview this workflow.",
			);
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
type Workflow = ReturnType<typeof useGraphRuns>;

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
				Run to this node
			</Button>
			<p className="text-muted-foreground text-xs">
				Generate upstream text first, then this node. Review the total credits
				before starting.
			</p>
		</div>
	);
}

function Steps({ run }: { run: Run }) {
	return (
		<ol className="flex flex-col gap-2">
			{run.steps.map((step, index) => (
				<li
					key={step.nodeId}
					className="flex items-start justify-between gap-3 text-sm"
				>
					<span className="min-w-0 break-words">
						{index + 1}. {step.label || step.kind}
					</span>
					<Badge
						variant={step.status === "failed" ? "destructive" : "secondary"}
					>
						{step.reused
							? "Reused"
							: step.status === "succeeded"
								? "Done"
								: step.status === "running"
									? "Generating"
									: step.status === "blocked"
										? "Blocked"
										: step.status === "failed"
											? "Failed"
											: "Waiting"}
					</Badge>
				</li>
			))}
		</ol>
	);
}

export function WorkflowMonitor({ workflow }: { workflow: Workflow }) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const run = workflow.active ?? workflow.latest;
	const completed =
		run?.steps.filter((step) => step.status === "succeeded").length ?? 0;
	return (
		<>
			{run ? (
				<Button
					variant="outline"
					size="sm"
					onClick={() => setDetailsOpen(true)}
				>
					{run.status === "running" ? (
						<LoaderCircleIcon
							data-icon="inline-start"
							className="animate-spin"
						/>
					) : (
						<WorkflowIcon data-icon="inline-start" />
					)}
					Workflow {completed}/{run.steps.length} ·{" "}
					{run.status === "succeeded"
						? "Complete"
						: run.status === "failed"
							? "Stopped"
							: "Running"}
				</Button>
			) : null}
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
					showCloseButton={!workflow.pending && !workflow.uncertain}
				>
					<DialogHeader>
						<DialogTitle>
							{workflow.preview?.request.resumeOf
								? "Resume workflow"
								: "Run to this node"}
						</DialogTitle>
						<DialogDescription>
							{workflow.preview?.request.resumeOf
								? "Continue the original saved prompts and settings. Completed steps are reused at no extra charge."
								: "Generate every node below in order using the saved prompts and settings. Previous results will be regenerated."}
						</DialogDescription>
					</DialogHeader>
					<ol className="flex max-h-64 flex-col gap-2 overflow-y-auto">
						{workflow.preview?.estimate.steps.map((step, index) => (
							<li
								key={step.nodeId}
								className="flex justify-between gap-3 text-sm"
							>
								<span>
									{index + 1}. {step.label || step.kind}
								</span>
								<span className="shrink-0 text-muted-foreground">
									{step.reused
										? "Reuse · 0 credits"
										: `${step.credits} ${step.credits === 1 ? "credit" : "credits"}`}
								</span>
							</li>
						))}
					</ol>
					<p className="text-sm">
						Total: <strong>{workflow.preview?.estimate.credits} credits</strong>{" "}
						· Your balance: {workflow.preview?.estimate.balance}
					</p>
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
			<Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Workflow progress</DialogTitle>
						<DialogDescription>
							{completed} of {run?.steps.length ?? 0} steps completed.{" "}
							{run?.status === "running"
								? "Running in the background."
								: run?.status === "succeeded"
									? "All outputs are saved to this project."
									: "Completed outputs are saved. Unfinished credits were released."}
						</DialogDescription>
					</DialogHeader>
					{run ? <Steps run={run} /> : null}
					{run?.error ? (
						<p role="alert" className="text-destructive text-sm">
							{run.error}
						</p>
					) : null}
					{run?.status === "failed" &&
					run.userId === workflow.userId &&
					!run.resumed ? (
						<DialogFooter>
							<Button
								disabled={
									!workflow.canRun || workflow.pending || workflow.uncertain
								}
								onClick={() => {
									setDetailsOpen(false);
									void workflow.review(run.nodeId, run.id);
								}}
							>
								Review and resume
							</Button>
						</DialogFooter>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}
