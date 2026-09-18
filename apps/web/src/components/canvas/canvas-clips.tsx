"use client";

import { clipActive, clipSettingsSchema } from "@kousa/media/clip-contracts";
import type { CanvasNode } from "@kousa/projects/canvas";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilmIcon } from "lucide-react";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";
import { AssetDownload, VideoPreview } from "./canvas-media";
import type { StudioNode } from "./use-canvas";

type Start = Parameters<typeof client.clips.start>[0];
type Preview = Awaited<ReturnType<typeof client.clips.preview>>;
export function useCanvasClips(
	userId: string,
	projectId: string,
	canvasId: string,
	loaded: boolean,
	canRun: boolean,
) {
	const cache = useQueryClient();
	const query = useQuery({
		...orpc.clips.list.queryOptions({ input: { projectId, canvasId } }),
		queryKey: ["clips", userId, projectId, canvasId],
		enabled: loaded,
		refetchInterval: 3000,
		retry: false,
	});
	const [review, setReview] = useState<{
		nodeId: string;
		value: Preview;
	} | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState<Start | null>(null);
	const busy = useRef(false);
	async function preview(nodeId: string) {
		if (!canRun || busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			setReview({
				nodeId,
				value: await client.clips.preview({ projectId, canvasId, nodeId }),
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not review clip.");
		} finally {
			busy.current = false;
			setPending(false);
		}
	}
	async function start() {
		if (!canRun || busy.current || (!review && !uncertain)) return;
		const request =
			uncertain ??
			(review
				? {
						id: crypto.randomUUID(),
						projectId,
						canvasId,
						nodeId: review.nodeId,
						inputHash: review.value.inputHash,
					}
				: null);
		if (!request) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await client.clips.start(request);
			setUncertain(null);
			setReview(null);
			toast.success("Clip queued. You can close the tab.");
		} catch (e) {
			const code =
				e && typeof e === "object" && "code" in e ? String(e.code) : "";
			setUncertain(
				[
					"BAD_REQUEST",
					"FORBIDDEN",
					"CONFLICT",
					"SERVICE_UNAVAILABLE",
					"UNAUTHORIZED",
					"NOT_FOUND",
				].includes(code)
					? null
					: request,
			);
			setError(
				e instanceof Error ? e.message : "Could not confirm clip creation.",
			);
		} finally {
			busy.current = false;
			setPending(false);
			await cache.invalidateQueries({
				queryKey: ["clips", userId, projectId, canvasId],
			});
		}
	}
	return {
		query,
		review,
		setReview,
		pending,
		error,
		uncertain,
		preview,
		start,
		canRun,
		runs: query.data?.runs ?? [],
		results: query.data?.results ?? [],
		active: query.data?.runs.find((r) => clipActive(r.status)),
	};
}
export const ClipContext = createContext<ReturnType<
	typeof useCanvasClips
> | null>(null);
export function useNodeClip(id: string) {
	const clips = useContext(ClipContext);
	return {
		run: clips?.runs.find((r) => r.nodeId === id),
		result: clips?.results.find((r) => r.nodeId === id),
	};
}
export const clipStatusLabels = {
	queued: "Queued",
	rendering: "Rendering",
	saving: "Saving",
	succeeded: "Complete",
	failed: "Failed",
};
export function ClipMonitor() {
	const clips = useContext(ClipContext);
	if (!clips) return null;
	return (
		<>
			{clips.active ? (
				<span role="status" className="text-muted-foreground text-xs">
					Clip · {clipStatusLabels[clips.active.status]}
				</span>
			) : null}
			<Dialog
				open={!!clips.review || !!clips.uncertain}
				onOpenChange={(open) => {
					if (!open && !clips.pending && !clips.uncertain)
						clips.setReview(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create clip</DialogTitle>
						<DialogDescription>
							Combine saved video and narration. No AI generation credits are
							used. Rendering continues if you close this tab.
						</DialogDescription>
					</DialogHeader>
					{clips.review ? (
						<div className="flex flex-col gap-2 text-sm">
							<p>
								{clips.review.value.plan.label} ·{" "}
								{(clips.review.value.plan.durationMs / 1000).toFixed(1)} seconds
							</p>
							<p>
								Narration starts at{" "}
								{clips.review.value.plan.narrationStartMs / 1000}s · Volume{" "}
								{Math.round(clips.review.value.plan.narrationVolume * 100)}%
							</p>
							<p>
								Original video volume{" "}
								{Math.round(clips.review.value.plan.videoVolume * 100)}%
							</p>
							<p className="text-muted-foreground">
								The clip keeps the video length. Narration beyond the end is
								trimmed; shorter narration leaves the remaining video intact.
							</p>
							{!clips.review.value.configured ? (
								<p role="alert">The server renderer is not configured yet.</p>
							) : null}
						</div>
					) : null}
					{clips.error ? (
						<p role="alert" className="text-destructive text-sm">
							{clips.error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							variant="outline"
							disabled={clips.pending || !!clips.uncertain}
							onClick={() => clips.setReview(null)}
						>
							Cancel
						</Button>
						<Button
							disabled={
								!clips.canRun ||
								clips.pending ||
								(!clips.uncertain && !clips.review?.value.configured)
							}
							onClick={() => void clips.start()}
						>
							{clips.pending
								? "Confirming…"
								: clips.uncertain
									? "Check this request"
									: "Create clip"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
export function ClipPanel({
	node,
	canEdit,
	update,
}: {
	node: StudioNode;
	canEdit: boolean;
	update: (data: Partial<CanvasNode["data"]>, field: string) => void;
}) {
	const clips = useContext(ClipContext);
	const { run, result } = useNodeClip(node.id);
	if (!clips) return null;
	const settings = clipSettingsSchema.parse(node.data.clipSettings ?? {});
	return (
		<section
			aria-label="Create narrated clip"
			className="flex flex-col gap-4 border-t pt-4"
		>
			<h3 className="font-medium text-sm">Narrated clip</h3>
			<p className="text-muted-foreground text-xs">
				Connect a Speech node to Audio. Choose existing outputs, then combine
				them into an MP4.
			</p>
			<FieldGroup>
				{(
					[
						{
							key: "narrationStartMs",
							label: "Narration start (seconds)",
							scale: 1000,
							max: 11.999,
							step: 0.1,
						},
						{
							key: "narrationVolume",
							label: "Narration volume (%)",
							scale: 0.01,
							max: 200,
							step: 1,
						},
						{
							key: "videoVolume",
							label: "Original video volume (%)",
							scale: 0.01,
							max: 200,
							step: 1,
						},
					] as const
				).map((field) => (
					<Field key={field.key} data-disabled={!canEdit}>
						<FieldLabel htmlFor={`clip-${field.key}`}>{field.label}</FieldLabel>
						<Input
							id={`clip-${field.key}`}
							type="number"
							min={0}
							max={field.max}
							step={field.step}
							disabled={!canEdit}
							value={
								Math.round((settings[field.key] / field.scale) * 1000) / 1000
							}
							onChange={(event) => {
								const value = event.currentTarget.valueAsNumber;
								if (Number.isFinite(value) && value >= 0 && value <= field.max)
									update(
										{
											clipSettings: {
												...settings,
												[field.key]:
													field.key === "narrationStartMs"
														? Math.round(value * field.scale)
														: value * field.scale,
											},
										},
										"clipSettings",
									);
							}}
						/>
					</Field>
				))}
				<FieldDescription>
					100% keeps the original volume. 0% mutes it. The exported clip keeps
					the video duration.
				</FieldDescription>
			</FieldGroup>
			{canEdit ? (
				<Button
					variant="outline"
					disabled={
						!clips.canRun ||
						clips.pending ||
						!!clips.active ||
						!!clips.uncertain ||
						clips.query.isPending ||
						clips.query.isError
					}
					onClick={() => void clips.preview(node.id)}
				>
					<FilmIcon data-icon="inline-start" />
					{clips.pending ? "Reviewing…" : "Review clip"}
				</Button>
			) : (
				<p className="text-muted-foreground text-xs">
					Only owners and editors can create clips.
				</p>
			)}
			{canEdit && !clips.canRun ? (
				<p className="text-muted-foreground text-xs">
					Wait for the canvas to connect and finish saving.
				</p>
			) : null}
			{clips.error && !clips.review ? (
				<p role="alert" className="text-destructive text-xs">
					{clips.error}
				</p>
			) : null}
			{clips.query.isError ? (
				<p role="alert" className="text-destructive text-xs">
					Could not load clip jobs.{" "}
					<Button
						size="sm"
						variant="outline"
						onClick={() => void clips.query.refetch()}
					>
						Retry
					</Button>
				</p>
			) : null}
			{run ? (
				<p role="status" className="text-muted-foreground text-xs">
					Clip · {clipStatusLabels[run.status]}
					{run.error ? ` · ${run.error}` : ""}
				</p>
			) : null}
			{result?.assetId ? (
				<>
					<VideoPreview assetId={result.assetId} />
					<AssetDownload assetId={result.assetId} kind="video" />
					<p className="text-muted-foreground text-xs">
						Saved clip. Changing inputs or settings takes effect when you create
						another clip.
					</p>
				</>
			) : null}
		</section>
	);
}
