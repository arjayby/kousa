"use client";

import { isRunActive } from "@kousa/generation/contracts";
import {
	type RunCredits,
	type RunStep,
	runStatusLabel,
} from "@kousa/generation/run-contracts";
import { Alert, AlertDescription } from "@kousa/ui/components/alert";
import { Badge } from "@kousa/ui/components/badge";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kousa/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { HistoryIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import { client } from "@/utils/orpc";
import type { useCanvasGeneration } from "./canvas-generation";
import {
	AssetDownload,
	AssetPreview,
	AudioPreview,
	VideoPreview,
} from "./canvas-media";

type Reference = { id: string; kind: "workflow" | "generation" };
type Cursor = { createdAt: string; id: string } | undefined;

function Credits({ value }: { value: RunCredits }) {
	return (
		<div className="flex flex-col gap-2">
			<dl className="grid grid-cols-3 gap-3">
				<div>
					<dt className="text-muted-foreground">Reserved</dt>
					<dd className="font-medium text-lg tabular-nums">{value.reserved}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Charged</dt>
					<dd className="font-medium text-lg tabular-nums">{value.charged}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Released</dt>
					<dd className="font-medium text-lg tabular-nums">{value.released}</dd>
				</div>
			</dl>
			<p className="text-muted-foreground">
				{value.total} {value.total === 1 ? "credit" : "credits"} reserved at
				start. Reused results cost 0 credits.
			</p>
		</div>
	);
}
function Step({
	step,
	loaded,
	exists,
	onFocus,
}: {
	step: RunStep;
	loaded: boolean;
	exists: boolean;
	onFocus: () => void;
}) {
	return (
		<li className="flex flex-col gap-2 rounded-none border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="min-w-0 break-words font-medium">{step.label}</span>
				<Badge variant={step.status === "failed" ? "destructive" : "secondary"}>
					{step.reused
						? "Reused"
						: step.status === "running" && step.stage === "saving"
							? "Saving result"
							: runStatusLabel[step.status]}
				</Badge>
			</div>
			<p className="text-muted-foreground">
				{step.kind} · {step.credits.charged} charged · {step.credits.reserved}{" "}
				reserved · {step.credits.released} released
			</p>
			{step.error ? (
				<Alert variant="destructive">
					<AlertDescription>{step.error}</AlertDescription>
				</Alert>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!exists}
					onClick={onFocus}
				>
					View node
				</Button>
				{!exists ? (
					<span className="text-muted-foreground">
						{loaded
							? "Node no longer on this canvas. Saved results remain available."
							: "Waiting for the canvas to load…"}
					</span>
				) : null}
			</div>
			{step.runId ? (
				<details>
					<summary className="cursor-pointer">
						Attempt details and output
					</summary>
					<div className="mt-3 flex min-w-0 flex-col gap-3">
						<p className="break-all text-muted-foreground">
							Attempt {step.runId} · {step.modelId}
						</p>
						{step.output ? (
							<pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans">
								{step.output}
							</pre>
						) : null}
						{step.assetId && step.mediaAvailable ? (
							<>
								{step.kind === "image" ? (
									<AssetPreview assetId={step.assetId} />
								) : step.kind === "video" ? (
									<VideoPreview assetId={step.assetId} />
								) : (
									<AudioPreview
										assetId={step.assetId}
										transcript={step.prompt}
									/>
								)}
								<AssetDownload
									assetId={step.assetId}
									kind={
										step.kind === "speech"
											? "audio"
											: step.kind === "video"
												? "video"
												: undefined
									}
								/>
							</>
						) : step.assetId ? (
							<p>The saved media is unavailable.</p>
						) : null}
						<details>
							<summary className="cursor-pointer">
								Frozen prompt / script
							</summary>
							<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">
								{step.prompt || "No text prompt"}
							</pre>
						</details>
					</div>
				</details>
			) : (
				<p className="text-muted-foreground">This step was not submitted.</p>
			)}
		</li>
	);
}

export function CanvasRunHistory({
	generation,
	canEdit,
	onFocus,
}: {
	generation: ReturnType<typeof useCanvasGeneration>;
	canEdit: boolean;
	onFocus: (id: string) => void;
}) {
	const { userId, projectId, canvasId, workflow, graph } = generation;
	const cache = useQueryClient();
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<Reference | null>(null);
	const history = useInfiniteQuery({
		queryKey: ["canvas-runs", userId, projectId, canvasId],
		initialPageParam: undefined as Cursor,
		queryFn: ({ pageParam }) =>
			client.runs.history({
				projectId,
				canvasId,
				cursor: pageParam,
				limit: 15,
			}),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: open,
		refetchInterval: open ? 3_000 : false,
		retry: false,
	});
	const runs = history.isError
		? []
		: (history.data?.pages.flatMap((p) => p.runs) ?? []);
	const reference = selected ?? runs[0];
	const detail = useQuery({
		queryKey: [
			"canvas-run",
			userId,
			projectId,
			canvasId,
			reference?.kind,
			reference?.id,
		],
		queryFn: () => {
			if (!reference) throw new Error("Choose a run.");
			return client.runs.detail({
				projectId,
				canvasId,
				id: reference.id,
				kind: reference.kind,
			});
		},
		enabled: open && !!reference && !history.isError,
		refetchInterval: open ? 3_000 : false,
		retry: false,
	});
	const cancel = useMutation({
		mutationFn: (ref: Reference) =>
			client.runs.cancel({ projectId, canvasId, ...ref }),
		onSettled: async () => {
			await Promise.allSettled(
				[
					["canvas-runs", userId, projectId, canvasId],
					["canvas-run", userId, projectId],
					["graph-runs", userId, projectId],
					["generation", userId, projectId],
					["generation-history", userId, projectId],
					["credits", userId],
				].map((queryKey) => cache.invalidateQueries({ queryKey })),
			);
		},
		retry: false,
	});
	const run = detail.isError || history.isError ? undefined : detail.data;
	const active =
		workflow.active || [...generation.runs.values()].some(isRunActive);
	const resumable =
		run?.kind === "workflow" &&
		(run.status === "failed" || run.status === "cancelled") &&
		!run.resumed &&
		run.completedSteps < run.totalSteps;
	const canReview =
		generation.canRun &&
		!generation.myRunActive &&
		!workflow.pending &&
		!workflow.uncertain;
	const nodeExists = (id: string) => graph.nodes.some((n) => n.id === id);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button variant="outline" size="sm" />}>
				{active ? (
					<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
				) : (
					<HistoryIcon data-icon="inline-start" />
				)}
				Runs{active ? " · Active" : ""}
			</DialogTrigger>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>Canvas runs</DialogTitle>
					<DialogDescription>
						Browse workflows and individual generations, inspect saved outputs,
						and manage unfinished work.
					</DialogDescription>
				</DialogHeader>
				{history.isError || detail.isError ? (
					<Alert variant="destructive">
						<AlertDescription>
							{history.error?.message ??
								detail.error?.message ??
								"Could not load runs."}
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									void history.refetch();
									void detail.refetch();
								}}
							>
								Refresh runs
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{history.isPending ? <p role="status">Loading runs…</p> : null}
				{!history.isPending && !history.isError && !runs.length ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No runs yet</EmptyTitle>
							<EmptyDescription>
								Generations and workflow runs will appear here, including
								attempts for deleted nodes.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : null}
				{runs.length ? (
					<div className="grid min-h-0 gap-5 sm:grid-cols-[15rem_minmax(0,1fr)]">
						<nav
							aria-label="Run history"
							className="flex min-h-0 flex-col gap-2 sm:overflow-y-auto"
						>
							{runs.map((item) => (
								<Button
									key={item.id}
									variant={item.id === reference?.id ? "secondary" : "outline"}
									className="h-auto justify-start whitespace-normal py-3 text-left"
									aria-pressed={item.id === reference?.id}
									onClick={() => {
										setSelected({ id: item.id, kind: item.kind });
										cancel.reset();
									}}
								>
									<span className="flex min-w-0 flex-col gap-1">
										<span className="break-words">{item.label}</span>
										<span>
											{item.kind === "workflow" ? "Workflow" : "Generation"} ·{" "}
											{runStatusLabel[item.status]}
										</span>
										<time dateTime={item.createdAt}>
											{new Date(item.createdAt).toLocaleString()}
										</time>
										<span>
											{item.userName} · {item.credits.charged} credits charged
										</span>
									</span>
								</Button>
							))}
							{history.hasNextPage ? (
								<Button
									variant="outline"
									disabled={history.isFetchingNextPage}
									onClick={() => void history.fetchNextPage()}
								>
									{history.isFetchingNextPage ? "Loading…" : "Load older runs"}
								</Button>
							) : null}
						</nav>
						<section
							aria-label="Run details"
							className="flex min-h-0 min-w-0 flex-col gap-4 sm:overflow-y-auto"
						>
							{detail.isPending ? (
								<p role="status">Loading run details…</p>
							) : null}
							{run ? (
								<>
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="min-w-0 break-words font-medium">
											{run.label}
										</h3>
										<Badge
											variant={
												run.status === "failed" ? "destructive" : "secondary"
											}
										>
											{runStatusLabel[run.status]}
										</Badge>
									</div>
									<p className="text-muted-foreground">
										Run by {run.userName} · {run.completedSteps}/
										{run.totalSteps} steps complete
									</p>
									<Credits value={run.credits} />
									{run.status === "stopping" ? (
										<Alert>
											<AlertDescription>
												{run.kind === "workflow"
													? "Future steps are stopped. "
													: ""}
												The submitted request is finishing. Its credits stay
												reserved until a result is saved or the request fails or
												expires.
											</AlertDescription>
										</Alert>
									) : run.cancelRequestedAt ? (
										<p className="text-muted-foreground">
											Stop requested{" "}
											{new Date(run.cancelRequestedAt).toLocaleString()}.
											Completed outputs are preserved; successful submitted work
											is charged.
										</p>
									) : null}
									{run.error ? (
										<Alert variant="destructive">
											<AlertDescription>{run.error}</AlertDescription>
										</Alert>
									) : null}
									{cancel.isError && cancel.variables?.id === run.id ? (
										<Alert variant="destructive">
											<AlertDescription>
												{cancel.error.message} You can retry the stop request
												safely.
											</AlertDescription>
										</Alert>
									) : null}
									{run.status === "queued" || run.status === "running" ? (
										<div className="flex flex-col gap-2">
											<Button
												variant="outline"
												disabled={!canEdit || cancel.isPending}
												onClick={() =>
													cancel.mutate({ id: run.id, kind: run.kind })
												}
											>
												{cancel.isPending ? (
													<LoaderCircleIcon
														data-icon="inline-start"
														className="animate-spin"
													/>
												) : (
													<SquareIcon data-icon="inline-start" />
												)}
												{run.kind === "workflow"
													? "Stop workflow"
													: run.status === "queued"
														? "Cancel queued run"
														: "Request stop"}
											</Button>
											<p className="text-muted-foreground">
												Queued work is cancelled immediately. Submitted requests
												may still finish and be charged. Completed outputs stay
												saved.
											</p>
											{!canEdit ? (
												<p className="text-muted-foreground">
													Only owners and editors can stop runs.
												</p>
											) : null}
										</div>
									) : null}
									{resumable ? (
										<div className="flex flex-col gap-2">
											<Button
												disabled={!canReview || run.userId !== userId}
												onClick={async () => {
													if (await workflow.review(run.targetNodeIds, run.id))
														setOpen(false);
												}}
											>
												Review and resume
											</Button>
											<p className="text-muted-foreground">
												Uses the original saved inputs. Completed steps are
												reused at no charge. Only {run.userName}, who started
												this workflow, can resume it.
											</p>
										</div>
									) : run.kind === "generation" &&
										(run.status === "failed" || run.status === "cancelled") ? (
										<Button
											variant="outline"
											disabled={
												!generation.canRun ||
												!nodeExists(run.targetNodeIds[0] ?? "")
											}
											onClick={() => {
												const id = run.targetNodeIds[0];
												if (id) {
													setOpen(false);
													onFocus(id);
												}
											}}
										>
											Open node to retry
										</Button>
									) : null}
									{workflow.error ? (
										<Alert variant="destructive">
											<AlertDescription>{workflow.error}</AlertDescription>
										</Alert>
									) : null}
									{run.resumeOf ? (
										<Button
											variant="link"
											onClick={() =>
												setSelected({
													kind: "workflow",
													id: run.resumeOf as string,
												})
											}
										>
											View original workflow
										</Button>
									) : null}
									{run.resumed ? (
										<p className="text-muted-foreground">
											This workflow has already been resumed. The continuation
											appears as a separate run.
										</p>
									) : null}
									<ol className="flex flex-col gap-3">
										{run.steps.map((step) => (
											<Step
												key={step.nodeId}
												step={step}
												loaded={generation.loaded}
												exists={nodeExists(step.nodeId)}
												onFocus={() => {
													setOpen(false);
													onFocus(step.nodeId);
												}}
											/>
										))}
									</ol>
									<p className="break-all text-muted-foreground">
										Run {run.id}
										{run.completedAt
											? ` · Finished ${new Date(run.completedAt).toLocaleString()}`
											: ""}
									</p>
								</>
							) : null}
						</section>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
