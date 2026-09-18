"use client";
import { retainProjectMedia, uploadProjectMedia } from "@kousa/media/upload";
import type { CanvasNode } from "@kousa/projects/canvas";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kousa/ui/components/select";
import { useRef, useState } from "react";
import { useNodeSpeech, useNodeVideo } from "./canvas-generation";
import {
	AssetDownload,
	AudioPreview,
	useCanvasMedia,
	VideoPreview,
} from "./canvas-media";
import type { StudioNode } from "./use-canvas";
export function StoredMediaPanel({
	node,
	canEdit,
	update,
}: {
	node: StudioNode;
	canEdit: boolean;
	update: (data: Partial<CanvasNode["data"]>, field: string) => void;
}) {
	const media = useCanvasMedia();
	const video = useNodeVideo(node.id);
	const speech = useNodeSpeech(node.id);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const isVideo = node.type === "video";
	const mime = isVideo ? "video/mp4" : "audio/mpeg";
	const selected =
		node.data.mediaSource === "project"
			? (node.data.assetId ?? "none")
			: "generated";
	const assetId =
		selected === "generated"
			? (isVideo ? video : speech)?.assetId
			: selected === "none"
				? null
				: selected;
	const items = [
		{
			value: "generated",
			label: node.data.selectedRunId
				? "Historical output selected"
				: "Latest generation",
		},
		{ value: "none", label: "No project file" },
		...media.assets
			.filter((a) => a.mimeType === mime)
			.map((a) => ({ value: a.id, label: a.name })),
	];
	if (!items.some((i) => i.value === selected))
		items.push({ value: selected, label: "Unavailable file" });
	async function upload(file: File) {
		if (!canEdit || busy.current) return;
		setError(null);
		if (file.type !== mime) {
			setError(
				isVideo
					? "Choose an H.264 MP4 up to 12 seconds and 20 MB."
					: "Choose MP3 speech up to 3 minutes and 10 MB.",
			);
			return;
		}
		busy.current = true;
		setPending(true);
		try {
			const asset = await uploadProjectMedia(media.projectId, file);
			update(
				{ selectedRunId: null, assetId: asset.id, mediaSource: "project" },
				"assetId",
			);
			await media.refresh();
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Upload failed. Retry the same file.",
			);
		} finally {
			busy.current = false;
			setPending(false);
		}
	}
	return (
		<section
			aria-label={isVideo ? "Video source" : "Speech source"}
			className="flex flex-col gap-4 border-t pt-4"
		>
			<h3 className="font-medium text-sm">
				{isVideo ? "Video source" : "Speech source"}
			</h3>
			<FieldGroup>
				<Field data-disabled={!canEdit || pending}>
					<FieldLabel htmlFor="stored-media-source">
						Use existing output
					</FieldLabel>
					<Select
						items={items}
						value={selected}
						disabled={!canEdit || pending || media.pending || media.error}
						onValueChange={async (value) => {
							if (!value || busy.current) return;
							busy.current = true;
							setPending(true);
							setError(null);
							try {
								if (value !== "generated" && value !== "none")
									await retainProjectMedia(media.projectId, value);
								if (value)
									update(
										value === "generated"
											? { selectedRunId: null, mediaSource: "generated" }
											: {
													selectedRunId: null,
													mediaSource: "project",
													assetId: value === "none" ? null : value,
												},
										"assetId",
									);
							} catch (cause) {
								setError(
									cause instanceof Error
										? cause.message
										: "Could not attach this file.",
								);
							} finally {
								busy.current = false;
								setPending(false);
							}
						}}
					>
						<SelectTrigger id="stored-media-source">
							<SelectValue />
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
					<FieldDescription>
						This is the saved media used for clip creation. AI generation
						remains a separate action.
					</FieldDescription>
				</Field>
				{canEdit ? (
					<Field data-disabled={pending}>
						<FieldLabel htmlFor="stored-media-upload">
							Upload {isVideo ? "video" : "speech"}
						</FieldLabel>
						<Input
							id="stored-media-upload"
							type="file"
							accept={mime}
							disabled={pending}
							onChange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								if (file) void upload(file);
							}}
						/>
						<FieldDescription>
							{isVideo
								? "H.264 MP4 with optional AAC audio · Up to 12 seconds and 20 MB."
								: "MP3 · Up to 3 minutes and 10 MB."}
						</FieldDescription>
					</Field>
				) : null}
			</FieldGroup>
			{pending ? <p role="status">Uploading…</p> : null}
			{error ? (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : null}
			{assetId && selected !== "generated" ? (
				<>
					{isVideo ? (
						<VideoPreview assetId={assetId} />
					) : (
						<AudioPreview
							assetId={assetId}
							transcript={
								media.assets.find((a) => a.id === assetId)?.transcript ?? null
							}
						/>
					)}
					<AssetDownload assetId={assetId} kind={isVideo ? "video" : "audio"} />
				</>
			) : null}
		</section>
	);
}
