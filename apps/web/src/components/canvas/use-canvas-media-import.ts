"use client";

import type { PublicAsset } from "@kousa/media/contracts";
import { uploadFileError, uploadProjectMedia } from "@kousa/media/upload";
import { useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Point = { x: number; y: number };
export function useCanvasMediaImport(options: {
	userId: string;
	projectId: string;
	canUpload: boolean;
	remaining: number;
	position: (screenPoint?: Point) => Point | undefined;
	onAssets: (assets: PublicAsset[], point?: Point) => boolean;
}) {
	const cache = useQueryClient();
	const latest = useRef(options);
	latest.current = options;
	const controller = useRef<AbortController | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const depth = useRef(0);
	const [dragging, setDragging] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState<{ files: File[]; point?: Point } | null>(
		null,
	);
	useEffect(
		() => () => {
			controller.current?.abort();
		},
		[],
	);
	// Capture canvas coordinates before uploading so panning does not move the import.
	async function upload(files: File[], point = latest.current.position()) {
		if (!files.length) return;
		if (controller.current) {
			toast("Wait for the current upload to finish.");
			return;
		}
		setError(null);
		setRetry(null);
		if (!latest.current.canUpload) {
			setError(
				"Uploads need editing access and a connected, saved canvas. Reconnect or ask the project owner for access.",
			);
			return;
		}
		if (files.length > latest.current.remaining) {
			setError(
				`This canvas has room for ${latest.current.remaining} more nodes. Choose fewer files or remove nodes first.`,
			);
			return;
		}
		for (const file of files) {
			const invalid = uploadFileError(file);
			if (invalid) {
				setError(`${file.name}: ${invalid} No files were uploaded.`);
				return;
			}
		}
		const request = new AbortController();
		controller.current = request;
		const saved: PublicAsset[] = [];
		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (!file) continue;
				setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
				try {
					if (!latest.current.canUpload)
						throw new Error(
							"Canvas access or connection changed. Reconnect before retrying the remaining files.",
						);
					saved.push(
						await uploadProjectMedia(options.projectId, file, request.signal),
					);
				} catch (cause) {
					if (request.signal.aborted) return;
					setError(
						`${file.name}: ${cause instanceof Error ? cause.message : "Upload failed. Retry the same file."}`,
					);
					setRetry({ files: files.slice(i), point });
					break;
				}
			}
			if (request.signal.aborted) return;
			if (saved.length) {
				const added =
					latest.current.canUpload && latest.current.onAssets(saved, point);
				toast(
					added
						? `${saved.length} media file${saved.length === 1 ? "" : "s"} added. Undo removes the nodes; files stay in Media library.`
						: "Files saved to Media library. The canvas changed before they could be added; use Add to canvas there.",
				);
				await cache.invalidateQueries({
					queryKey: ["media", options.userId, options.projectId],
				});
			}
		} finally {
			if (!request.signal.aborted) setProgress(null);
			controller.current = null;
		}
	}
	const hasFiles = (event: DragEvent) =>
		event.dataTransfer.types.includes("Files");
	return {
		input,
		dragging,
		progress,
		error,
		retry,
		upload,
		dismiss: () => {
			setError(null);
			setRetry(null);
		},
		dropHandlers: {
			onDragEnter: (event: DragEvent) => {
				if (hasFiles(event)) {
					event.preventDefault();
					depth.current++;
					setDragging(true);
				}
			},
			onDragOver: (event: DragEvent) => {
				if (hasFiles(event)) {
					event.preventDefault();
					event.dataTransfer.dropEffect =
						options.canUpload && !progress ? "copy" : "none";
				}
			},
			onDragLeave: (event: DragEvent) => {
				if (hasFiles(event)) {
					depth.current = Math.max(0, depth.current - 1);
					if (!depth.current) setDragging(false);
				}
			},
			onDrop: (event: DragEvent) => {
				if (!hasFiles(event)) return;
				event.preventDefault();
				depth.current = 0;
				setDragging(false);
				void upload(
					Array.from(event.dataTransfer.files),
					options.position({ x: event.clientX, y: event.clientY }),
				);
			},
		},
	};
}
