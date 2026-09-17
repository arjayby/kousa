"use client";

import {
	imageMimeTypes,
	maxImageBytes,
	mediaListSchema,
	mediaUploadSchema,
	mediaUrl,
	type ProjectAsset,
} from "@kousa/media/contracts";
import { type CanvasNode, imageOutputAssetId } from "@kousa/projects/canvas";
import { Button } from "@kousa/ui/components/button";
import {
	Field,
	FieldDescription,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { StudioNode } from "./use-canvas";

async function responseBody(response: Response) {
	const body = await response.json();
	if (!response.ok)
		throw new Error(
			body &&
				typeof body === "object" &&
				"message" in body &&
				typeof body.message === "string"
				? body.message
				: "Could not access project media.",
		);
	return body;
}
const MediaContext = createContext<{
	projectId: string;
	assets: ProjectAsset[];
	pending: boolean;
	refreshing: boolean;
	error: boolean;
	refresh: () => Promise<void>;
	previewAttempts: Record<string, number>;
	retryPreview: (assetId: string) => void;
} | null>(null);
export function useCanvasMedia() {
	const media = useContext(MediaContext);
	if (!media) throw new Error("CanvasMediaProvider is required.");
	return media;
}
export function CanvasMediaProvider({
	userId,
	projectId,
	loaded,
	children,
}: {
	userId: string;
	projectId: string;
	loaded: boolean;
	children: ReactNode;
}) {
	const cache = useQueryClient();
	const [previewAttempts, setPreviewAttempts] = useState<
		Record<string, number>
	>({});
	const queryKey = ["media", userId, projectId];
	const query = useQuery({
		queryKey,
		queryFn: async ({ signal }) =>
			mediaListSchema.parse(
				await responseBody(
					await fetch(mediaUrl(projectId), { signal, cache: "no-store" }),
				),
			),
		enabled: loaded,
		refetchInterval: 10_000,
		retry: false,
	});
	return (
		<MediaContext
			value={{
				projectId,
				assets: query.data?.assets ?? [],
				pending: query.isPending,
				refreshing: query.isFetching,
				error: query.isError,
				previewAttempts,
				retryPreview: (assetId) =>
					setPreviewAttempts((attempts) => ({
						...attempts,
						[assetId]: (attempts[assetId] ?? 0) + 1,
					})),
				refresh: () => cache.invalidateQueries({ queryKey }),
			}}
		>
			{children}
		</MediaContext>
	);
}

export function AssetPreview({
	assetId,
	compact = false,
}: {
	assetId: string;
	compact?: boolean;
}) {
	const media = useContext(MediaContext);
	const [failedSource, setFailedSource] = useState<string | null>(null);
	if (!media) return null;
	const source = `${mediaUrl(media.projectId, assetId)}?v=${media.previewAttempts[assetId] ?? 0}`;
	const asset = media.assets.find((asset) => asset.id === assetId);
	if (failedSource === source)
		return (
			<div className="flex flex-col items-center gap-2 rounded-md border bg-muted/30 p-3 text-muted-foreground text-xs">
				<p>Image unavailable</p>
				{!compact ? (
					<Button
						size="sm"
						variant="outline"
						onClick={() => media.retryPreview(assetId)}
					>
						Retry preview
					</Button>
				) : null}
			</div>
		);
	return (
		// Authenticated images must load directly with the viewer's session cookie.
		<img
			src={source}
			alt={asset?.name ?? "Project image"}
			width={asset?.width ?? undefined}
			height={asset?.height ?? undefined}
			loading="lazy"
			draggable={false}
			onError={() => setFailedSource(source)}
			className={
				compact
					? "mb-3 max-h-48 w-full rounded-md bg-muted/30 object-contain"
					: "max-h-64 w-full rounded-md border bg-muted/30 object-contain"
			}
		/>
	);
}

export function AssetDownload({
	assetId,
	kind = "image",
}: {
	assetId: string;
	kind?: "image" | "audio" | "video";
}) {
	const media = useContext(MediaContext);
	if (!media) return null;
	const asset = media.assets.find((asset) => asset.id === assetId);
	return (
		<a
			className="text-xs underline underline-offset-4"
			href={mediaUrl(media.projectId, assetId)}
			download={asset?.name ?? `generated-${kind}`}
		>
			Download {kind}
		</a>
	);
}

export function ImageMediaPanel({
	node,
	generatedAssetId,
	canEdit,
	update,
}: {
	node: StudioNode;
	generatedAssetId?: string | null;
	canEdit: boolean;
	update: (data: Partial<CanvasNode["data"]>, field: string) => void;
}) {
	const media = useContext(MediaContext);
	const [uploading, setUploading] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	if (!media) return null;
	const selectedId = imageOutputAssetId(node.data, generatedAssetId);
	const selectedValue =
		(node.data.imageSource ?? (node.data.assetId ? "project" : "generated")) ===
		"generated"
			? "generated"
			: (node.data.assetId ?? "none");
	const asset = media.assets.find((asset) => asset.id === selectedId);
	const items = [
		{ value: "none", label: "No image" },
		{ value: "generated", label: "Latest generation" },
		...media.assets
			.filter((asset) => asset.mimeType.startsWith("image/"))
			.map((asset) => ({ value: asset.id, label: asset.name })),
	];
	if (
		node.data.assetId &&
		!media.assets.some((asset) => asset.id === node.data.assetId)
	)
		items.push({ value: node.data.assetId, label: "Current image" });
	async function upload(file: File) {
		if (!media || busy.current || !canEdit) return;
		setError(null);
		if (
			!file.size ||
			file.size > maxImageBytes ||
			!imageMimeTypes.some((type) => type === file.type)
		) {
			setError("Choose a PNG, JPEG, or WebP image up to 10 MB.");
			return;
		}
		busy.current = true;
		setUploading(true);
		try {
			const response = await fetch(mediaUrl(media.projectId), {
				method: "POST",
				headers: {
					"Content-Type": file.type,
					"X-File-Name": encodeURIComponent(file.name),
				},
				body: file,
			});
			const { asset } = mediaUploadSchema.parse(await responseBody(response));
			media.retryPreview(asset.id);
			update({ assetId: asset.id, imageSource: "project" }, "assetId");
			await media.refresh();
			toast.success("Image saved to project");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Upload interrupted. Choose the same file to retry.",
			);
		} finally {
			busy.current = false;
			setUploading(false);
		}
	}
	return (
		<section
			aria-label="Project images"
			className="flex flex-col gap-4 border-t pt-4"
		>
			<h3 className="font-medium text-sm">Image output</h3>
			{selectedId ? (
				<>
					<AssetPreview key={selectedId} assetId={selectedId} />
					{asset ? (
						<p className="break-words text-muted-foreground text-xs">
							{asset.name} · {asset.width} × {asset.height} ·{" "}
							{(asset.bytes / 1024 / 1024).toFixed(2)} MB
						</p>
					) : null}
				</>
			) : (
				<p className="text-muted-foreground text-xs">No image attached yet.</p>
			)}
			{canEdit ? (
				<>
					<Field>
						<FieldLabel htmlFor="node-image-upload">Upload image</FieldLabel>
						<Input
							id="node-image-upload"
							type="file"
							accept={imageMimeTypes.join(",")}
							disabled={uploading}
							onChange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								if (file) void upload(file);
							}}
						/>
						<FieldDescription>
							PNG, JPEG, or WebP · Up to 10 MB and 40 megapixels. Shared with
							project members.
						</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor="node-project-image">Show on node</FieldLabel>
						<Select
							items={items}
							value={selectedValue}
							disabled={uploading || media.pending || media.error}
							onValueChange={(value) => {
								if (value)
									update(
										value === "generated"
											? { imageSource: "generated" }
											: {
													assetId: value === "none" ? null : value,
													imageSource: "project",
												},
										"assetId",
									);
							}}
						>
							<SelectTrigger id="node-project-image" className="w-full">
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
							Removing an attachment keeps the file available for other nodes.
							Project limit: 100 media files or 100 MB.
						</FieldDescription>
					</Field>
				</>
			) : (
				<p className="text-muted-foreground text-xs">
					Only owners and editors can upload or change images.
				</p>
			)}
			{uploading ? (
				<p
					role="status"
					className="flex items-center gap-2 text-muted-foreground text-xs"
				>
					<LoaderCircleIcon
						className="size-3 animate-spin"
						aria-hidden="true"
					/>
					Uploading image…
				</p>
			) : null}
			{error ? (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : null}
			{media.error ? (
				<div className="flex flex-col gap-2">
					<p role="alert" className="text-destructive text-xs">
						Could not load project images.
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void media.refresh()}
					>
						Reload images
					</Button>
				</div>
			) : null}
		</section>
	);
}

export function AudioPreview({
	assetId,
	transcript,
	compact = false,
}: {
	assetId: string;
	transcript: string | null;
	compact?: boolean;
}) {
	const media = useContext(MediaContext);
	const [failedSource, setFailedSource] = useState<string | null>(null);
	if (!media) return null;
	const source = `${mediaUrl(media.projectId, assetId)}?v=${media.previewAttempts[assetId] ?? 0}`;
	return (
		<div className="nodrag nopan nowheel flex min-w-0 flex-col gap-2">
			{failedSource === source ? (
				<div role="alert" className="flex flex-col gap-2 text-xs">
					<p>Audio unavailable.</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() => media.retryPreview(assetId)}
					>
						Retry audio
					</Button>
				</div>
			) : (
				// biome-ignore lint/a11y/useMediaCaption: Prerecorded speech has its complete text alternative in the adjacent transcript.
				<audio
					key={source}
					controls
					preload={compact ? "none" : "metadata"}
					src={source}
					aria-label="Generated speech"
					className="h-10 w-full min-w-0"
					onError={() => setFailedSource(source)}
				/>
			)}
			{transcript ? (
				<details className="text-muted-foreground text-xs">
					<summary className="cursor-pointer">Spoken script</summary>
					<p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
						{transcript}
					</p>
				</details>
			) : null}
		</div>
	);
}

export function VideoPreview({
	assetId,
	compact = false,
}: {
	assetId: string;
	compact?: boolean;
}) {
	const media = useContext(MediaContext);
	const [failedSource, setFailedSource] = useState<string | null>(null);
	if (!media) return null;
	const source = `${mediaUrl(media.projectId, assetId)}?v=${media.previewAttempts[assetId] ?? 0}`;
	const asset = media.assets.find((a) => a.id === assetId);
	return (
		<div className="nodrag nopan nowheel flex min-w-0 flex-col gap-2">
			{failedSource === source ? (
				<div role="alert" className="flex flex-col gap-2 text-xs">
					<p>Video unavailable.</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() => media.retryPreview(assetId)}
					>
						Retry video
					</Button>
				</div>
			) : (
				// biome-ignore lint/a11y/useMediaCaption: This version only generates silent video with no audio track to caption.
				<video
					key={source}
					controls
					playsInline
					preload={compact ? "none" : "metadata"}
					src={source}
					aria-label="Generated silent video"
					className="max-h-72 w-full rounded-md bg-black"
					onError={() => setFailedSource(source)}
				/>
			)}
			{!compact && asset ? (
				<p className="break-words text-muted-foreground text-xs">
					{asset.width} × {asset.height} ·{" "}
					{((asset.durationMs ?? 0) / 1000).toFixed(1)} seconds ·{" "}
					{(asset.bytes / 1024 / 1024).toFixed(2)} MB · Silent
				</p>
			) : null}
		</div>
	);
}
