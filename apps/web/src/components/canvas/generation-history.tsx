"use client";

import { isRunActive, runProgress } from "@kousa/generation/contracts";
import type { CanvasNode } from "@kousa/projects/canvas";
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
import { useInfiniteQuery } from "@tanstack/react-query";
import {
	CopyIcon,
	DownloadIcon,
	HistoryIcon,
	LoaderCircleIcon,
} from "lucide-react";
import { useContext, useRef, useState } from "react";
import { client } from "@/utils/orpc";
import { GenerationContext } from "./canvas-generation";
import {
	AssetDownload,
	AssetPreview,
	AudioPreview,
	VideoPreview,
} from "./canvas-media";
import type { StudioNode } from "./use-canvas";

type HistoryRun = Awaited<
	ReturnType<typeof client.generation.history>
>["runs"][number];
type Cursor = { createdAt: string; id: string } | undefined;
export type ApplyHistory = (
	before: CanvasNode,
	patch: Partial<CanvasNode["data"]>,
) => boolean;

function downloadText(run: HistoryRun) {
	const url = URL.createObjectURL(
		new Blob([run.output ?? ""], { type: "text/plain;charset=utf-8" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = `generation-${run.id}.txt`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function GenerationHistory({
	node,
	apply,
}: {
	node: StudioNode;
	apply: ApplyHistory;
}) {
	const generation = useContext(GenerationContext);
	const [open, setOpen] = useState(false);
	const [inspectedId, setInspectedId] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const projectId = generation?.projectId ?? "";
	const canvasId = generation?.canvasId;
	const query = useInfiniteQuery({
		queryKey: [
			"generation-history",
			generation?.userId,
			projectId,
			canvasId,
			node.id,
		],
		queryFn: ({ pageParam }) =>
			client.generation.history({
				projectId,
				canvasId,
				nodeId: node.id,
				limit: 10,
				cursor: pageParam,
			}),
		initialPageParam: undefined as Cursor,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: open && Boolean(generation),
		refetchInterval: open ? 3_000 : false,
		retry: false,
	});
	if (!generation) return null;
	const runs = [
		...new Map(
			(query.data?.pages.flatMap((page) => page.runs) ?? []).map((run) => [
				run.id,
				run,
			]),
		).values(),
	];
	const inspected = runs.find((run) => run.id === inspectedId) ?? runs[0];
	const editable = generation.canRun && !pending;
	const active = isRunActive(generation.runs.get(node.id));
	async function change(run: HistoryRun, action: "select" | "restore") {
		if (!editable || busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		setMessage(null);
		const before = {
			id: node.id,
			type: node.type ?? "text",
			position: node.position,
			data: { ...node.data },
		};
		try {
			const result = await client.generation.historyAction({
				projectId,
				canvasId,
				nodeId: node.id,
				runId: run.id,
				action,
			});
			if (!apply(before, result.patch))
				throw new Error(
					"The node or your access changed. Review its current settings and try again.",
				);
			setMessage(
				action === "select"
					? "Output selected for future work. Active runs keep their saved inputs. No credits spent."
					: "Prompt and settings restored. No generation started; the selected output is unchanged.",
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not apply this history entry.",
			);
		} finally {
			busy.current = false;
			setPending(false);
		}
	}
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setMessage("Copied to clipboard.");
		} catch {
			setError("Could not copy. Select the text and copy it manually.");
		}
	}
	function useLatest() {
		if (!editable) return;
		if (
			!apply({ ...node, type: node.type ?? "text" }, { selectedRunId: null })
		) {
			setError("The node or your access changed. Try again.");
			return;
		}
		setMessage("Using the latest successful generation. No credits spent.");
	}
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button variant="outline" />}>
				<HistoryIcon data-icon="inline-start" />
				Generation history
			</DialogTrigger>
			{node.data.selectedRunId ? (
				<p className="text-muted-foreground text-xs">
					A historical output is selected. New generations will not replace it.
					Open history to use the latest output.
				</p>
			) : null}
			<DialogContent className="flex max-h-[88dvh] flex-col sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>
						{node.data.label || node.type} · Generation history
					</DialogTitle>
					<DialogDescription>
						Browse individual and workflow attempts. Selecting an output and
						restoring settings are separate actions; neither spends credits.
					</DialogDescription>
				</DialogHeader>
				{error || query.error ? (
					<Alert variant="destructive">
						<AlertDescription>
							{error ?? query.error?.message}
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									setError(null);
									void query.refetch();
								}}
							>
								Refresh history
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{message ? <p role="status">{message}</p> : null}
				{node.data.selectedRunId ? (
					<div className="flex items-center justify-between gap-3">
						<Badge variant="secondary">Historical output selected</Badge>
						<Button
							variant="outline"
							size="sm"
							disabled={!editable}
							onClick={useLatest}
						>
							Use latest generation
						</Button>
					</div>
				) : null}
				{query.isPending ? (
					<p role="status" className="flex items-center gap-2">
						<LoaderCircleIcon className="size-4 animate-spin" />
						Loading history…
					</p>
				) : null}
				{!query.isPending && !query.isError && !runs.length ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No generations yet</EmptyTitle>
							<EmptyDescription>
								Attempts will appear here after this node runs, including runs
								started as part of a workflow.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : null}
				{inspected ? (
					<div className="grid min-h-0 gap-4 overflow-y-auto sm:grid-cols-[15rem_minmax(0,1fr)]">
						<div className="flex flex-col gap-2 sm:overflow-y-auto">
							{runs.map((run) => (
								<Button
									key={run.id}
									variant={run.id === inspected.id ? "secondary" : "outline"}
									className="h-auto justify-start whitespace-normal py-3 text-left"
									aria-pressed={run.id === inspected.id}
									onClick={() => setInspectedId(run.id)}
								>
									<span className="flex min-w-0 flex-col gap-1">
										<time dateTime={run.createdAt}>
											{new Date(run.createdAt).toLocaleString()}
										</time>
										<span>
											{runProgress(run) ??
												(run.status === "succeeded"
													? "Succeeded"
													: "Failed")}{" "}
											· {run.userName}
										</span>
										<span>
											{run.credits} credits {run.creditState}
											{run.graphRunId ? " · Workflow" : ""}
										</span>
										{node.data.selectedRunId === run.id ? (
											<Badge variant="outline">Selected output</Badge>
										) : null}
									</span>
								</Button>
							))}
							{query.hasNextPage ? (
								<Button
									variant="outline"
									disabled={query.isFetchingNextPage}
									onClick={() => void query.fetchNextPage()}
								>
									{query.isFetchingNextPage
										? "Loading…"
										: "Load older generations"}
								</Button>
							) : null}
						</div>
						<section
							className="flex min-w-0 flex-col gap-4 sm:overflow-y-auto"
							aria-label="Generation details"
						>
							<div className="flex flex-wrap gap-2">
								<Badge
									variant={
										inspected.status === "failed" ? "destructive" : "secondary"
									}
								>
									{runProgress(inspected) ?? inspected.status}
								</Badge>
								<Badge variant="outline">
									{inspected.credits} credits {inspected.creditState}
								</Badge>
							</div>
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-words">
								<dt>Run by</dt>
								<dd>{inspected.userName}</dd>
								<dt>Model</dt>
								<dd>{inspected.modelId}</dd>
								<dt>Started</dt>
								<dd>{new Date(inspected.createdAt).toLocaleString()}</dd>
								{inspected.completedAt ? (
									<>
										<dt>Finished</dt>
										<dd>{new Date(inspected.completedAt).toLocaleString()}</dd>
									</>
								) : null}
								{inspected.size ? (
									<>
										<dt>Image size</dt>
										<dd>{inspected.size}</dd>
									</>
								) : null}
								{inspected.duration ? (
									<>
										<dt>Video</dt>
										<dd>
											{inspected.duration}s · {inspected.aspectRatio}
										</dd>
									</>
								) : null}
								{inspected.voiceId ? (
									<>
										<dt>Voice</dt>
										<dd>{inspected.voiceId}</dd>
										<dt>Direction</dt>
										<dd>{inspected.voiceDirection || "Default delivery"}</dd>
									</>
								) : null}
								<dt>Run ID</dt>
								<dd>{inspected.id}</dd>
								{inspected.graphRunId ? (
									<>
										<dt>Workflow ID</dt>
										<dd>{inspected.graphRunId}</dd>
									</>
								) : null}
							</dl>
							{inspected.error ? (
								<Alert variant="destructive">
									<AlertDescription>{inspected.error}</AlertDescription>
								</Alert>
							) : null}
							{inspected.output ? (
								<>
									<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">
										{inspected.output}
									</pre>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => void copy(inspected.output ?? "")}
										>
											<CopyIcon data-icon="inline-start" />
											Copy output
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => downloadText(inspected)}
										>
											<DownloadIcon data-icon="inline-start" />
											Download text
										</Button>
									</div>
								</>
							) : null}
							{inspected.assetId && inspected.mediaAvailable ? (
								<>
									{inspected.kind === "image" ? (
										<AssetPreview
											key={inspected.assetId}
											assetId={inspected.assetId}
										/>
									) : inspected.kind === "video" ? (
										<VideoPreview
											key={inspected.assetId}
											assetId={inspected.assetId}
										/>
									) : (
										<AudioPreview
											key={inspected.assetId}
											assetId={inspected.assetId}
											transcript={inspected.transcript}
										/>
									)}
									<AssetDownload
										assetId={inspected.assetId}
										kind={
											inspected.kind === "speech"
												? "audio"
												: inspected.kind === "video"
													? "video"
													: undefined
										}
									/>
								</>
							) : inspected.assetId ? (
								<Alert>
									<AlertDescription>
										The saved media is unavailable. Its run details remain
										available.
									</AlertDescription>
								</Alert>
							) : null}
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={
										!editable ||
										inspected.status !== "succeeded" ||
										!inspected.mediaAvailable ||
										node.data.selectedRunId === inspected.id
									}
									onClick={() => void change(inspected, "select")}
								>
									Use this output
								</Button>
								<Button
									variant="outline"
									disabled={!editable || active || !inspected.settings}
									onClick={() => void change(inspected, "restore")}
								>
									Restore settings
								</Button>
							</div>
							{!generation.canRun ? (
								<p className="text-muted-foreground">
									Changing shared outputs or settings requires synchronized
									editor access.
								</p>
							) : null}
							{active ? (
								<p className="text-muted-foreground">
									Settings restoration is available when this node finishes
									generating. Selecting an output applies to future work.
								</p>
							) : null}
							{!inspected.settings ? (
								<p className="text-muted-foreground">
									This older run has no authored settings snapshot. Its frozen
									provider prompt is available below.
								</p>
							) : (
								<details>
									<summary className="cursor-pointer">
										Authored prompt saved with this run
									</summary>
									<pre className="mt-2 whitespace-pre-wrap break-words font-sans">
										{inspected.settings.content || "No authored text"}
									</pre>
								</details>
							)}
							<details>
								<summary className="cursor-pointer">
									Frozen provider prompt / script
								</summary>
								<pre className="my-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">
									{inspected.prompt || "No text prompt"}
								</pre>
								<Button
									variant="outline"
									size="sm"
									onClick={() => void copy(inspected.prompt)}
								>
									Copy frozen prompt
								</Button>
							</details>
						</section>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
