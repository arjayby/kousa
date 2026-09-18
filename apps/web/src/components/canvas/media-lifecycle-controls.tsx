"use client";

import {
	mediaLifecycleHeaders,
	mediaLifecycleSchema,
	mediaUrl,
} from "@kousa/media/contracts";
import { uploadAccept, uploadProjectMedia } from "@kousa/media/upload";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import { Progress } from "@kousa/ui/components/progress";
import { useQuery } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { z } from "zod";
import { useCanvasMedia } from "./canvas-media";

export type MediaUsage = z.infer<typeof mediaLifecycleSchema>;
export function useMediaLifecycle(open: boolean) {
	const media = useCanvasMedia();
	return useQuery({
		queryKey: ["media-lifecycle", media.userId, media.projectId],
		enabled: open,
		refetchInterval: open ? 30000 : false,
		retry: false,
		queryFn: async ({ signal }) => {
			const res = await fetch(`${mediaUrl(media.projectId)}?view=lifecycle`, {
				signal,
				cache: "no-store",
				headers: mediaLifecycleHeaders,
			});
			if (!res.ok) throw new Error("Could not check media usage.");
			return mediaLifecycleSchema.parse(await res.json());
		},
	});
}
export function MediaStorageSummary({
	state,
	loading,
	error,
	retry,
}: {
	state?: MediaUsage;
	loading: boolean;
	error: boolean;
	retry: () => void;
}) {
	if (error)
		return (
			<Alert variant="destructive">
				<AlertTitle>Usage could not be checked</AlertTitle>
				<AlertDescription>
					<p>
						Refresh to check storage and references. Removal is disabled until
						this check succeeds.
					</p>
					<Button variant="outline" onClick={retry}>
						Retry usage check
					</Button>
				</AlertDescription>
			</Alert>
		);
	if (loading || !state)
		return <p role="status">Checking project storage and references…</p>;
	const { storage } = state;
	return (
		<section aria-label="Project storage" className="flex flex-col gap-2">
			<div className="flex flex-wrap justify-between gap-2">
				<p>
					{(storage.bytes / 1048576).toFixed(2)} of {storage.maxBytes / 1048576}{" "}
					MB
				</p>
				<p>
					{storage.files} of {storage.maxFiles} files
				</p>
			</div>
			<Progress
				value={Math.min(
					100,
					Math.max(
						storage.bytes / storage.maxBytes,
						storage.files / storage.maxFiles,
					) * 100,
				)}
				aria-label="Project storage limit used"
			/>
			<p className="text-muted-foreground">
				{storage.pendingFiles
					? `${storage.pendingFiles} unfinished files reserve ${(storage.pendingBytes / 1048576).toFixed(2)} MB. `
					: ""}
				{storage.removingFiles
					? `${storage.removingFiles} files await removal; cleanup retries every 15 minutes. `
					: ""}
				Unused library uploads are cleaned up after 7 days. Canvas, undo, run,
				and clip references keep files retained.
			</p>
			{!state.graphAvailable ? (
				<p role="status">
					The shared canvas is unavailable. Unreferenced status cannot be
					confirmed; removal is disabled.
				</p>
			) : null}
		</section>
	);
}
export function LibraryUpload({
	canEdit,
	refresh,
}: {
	canEdit: boolean;
	refresh: () => Promise<unknown>;
}) {
	const media = useCanvasMedia();
	const input = useRef<HTMLInputElement>(null);
	const busy = useRef(false);
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	async function upload(file: File) {
		if (!canEdit || busy.current) return;
		busy.current = true;
		setPending(true);
		setMessage(null);
		try {
			const asset = await uploadProjectMedia(
				media.projectId,
				file,
				undefined,
				true,
			);
			setMessage(
				`${asset.name} saved to Media library. Add it to the canvas to keep it, or remove it while unused.`,
			);
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "Upload failed. Retry the same file.",
			);
		} finally {
			busy.current = false;
			setPending(false);
			await Promise.all([media.refresh(), refresh()]);
		}
	}
	return (
		<div className="flex flex-col gap-2">
			{canEdit ? (
				<>
					<input
						ref={input}
						hidden
						type="file"
						accept={uploadAccept}
						aria-label="Upload a library file"
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = "";
							if (file) void upload(file);
						}}
					/>
					<Button
						variant="outline"
						disabled={pending}
						onClick={() => input.current?.click()}
					>
						<UploadIcon data-icon="inline-start" />
						{pending ? "Uploading…" : "Upload to library"}
					</Button>
				</>
			) : null}
			{message ? (
				<p role="status" className="text-muted-foreground">
					{message}
				</p>
			) : null}
		</div>
	);
}
export function AssetUsage({ usage }: { usage?: MediaUsage["usage"][number] }) {
	return (
		<section
			aria-label="Where this file is used"
			className="flex flex-col gap-2"
		>
			<h3 className="font-medium">Where this file is used</h3>
			{!usage ? (
				<p>Refresh to check this file's references.</p>
			) : (
				<>
					{usage.references.length ? (
						<ul className="list-disc pl-5">
							{usage.references.slice(0, 20).map((ref, index) => (
								<li key={`${ref.kind}:${index}`}>
									{ref.kind === "canvas" ? "Canvas · " : ""}
									{ref.label}
								</li>
							))}
						</ul>
					) : (
						<p>No references were reported by this check.</p>
					)}
					{usage.references.length > 20 ? (
						<p>{usage.references.length - 20} more retained references.</p>
					) : null}
					<p className="text-muted-foreground">
						{usage.reason ??
							"This file has no recorded use and can be permanently removed."}
					</p>
					{usage.cleanupAt ? (
						<p>
							Automatic cleanup after{" "}
							{new Date(usage.cleanupAt).toLocaleString()} unless used first.
						</p>
					) : null}
				</>
			)}
		</section>
	);
}
