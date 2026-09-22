"use client";

import { playgroundMediaUrl } from "@kousa/generation/playground-contracts";
import { mediaUrl } from "@kousa/media/contracts";
import type { GalleryAsset } from "@kousa/media/gallery-contracts";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import { AudioLinesIcon, DownloadIcon, FilmIcon } from "lucide-react";
import { useState } from "react";

export function assetKind(asset: GalleryAsset) {
	return asset.mimeType === "video/mp4"
		? "Video"
		: asset.mimeType === "audio/mpeg"
			? "Audio"
			: "Image";
}

function assetUrl(asset: GalleryAsset) {
	return asset.projectId
		? mediaUrl(asset.projectId, asset.id)
		: playgroundMediaUrl(asset.id);
}

export function assetDetails(asset: GalleryAsset) {
	return [
		asset.mimeType.split("/")[1]?.toUpperCase().replace("MPEG", "MP3"),
		asset.width && asset.height ? `${asset.width} × ${asset.height}` : null,
		asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} sec` : null,
		asset.bytes >= 1024 * 1024
			? `${(asset.bytes / (1024 * 1024)).toFixed(1)} MB`
			: `${Math.max(1, Math.round(asset.bytes / 1024))} KB`,
	]
		.filter(Boolean)
		.join(" · ");
}

export function MediaThumbnail({ asset }: { asset: GalleryAsset }) {
	const [failed, setFailed] = useState(false);
	if (failed)
		return (
			<span className="px-4 text-muted-foreground text-sm">
				Preview unavailable
			</span>
		);
	if (assetKind(asset) === "Image") {
		return (
			<img
				src={assetUrl(asset)}
				alt={asset.name}
				loading="lazy"
				className="size-full object-contain"
				onError={() => setFailed(true)}
			/>
		);
	}
	const Icon = assetKind(asset) === "Video" ? FilmIcon : AudioLinesIcon;
	return (
		<span className="flex flex-col items-center gap-3 text-muted-foreground">
			<Icon className="size-10" aria-hidden="true" />
			<span className="text-xs">
				{assetKind(asset) === "Video" ? "Play video" : "Listen to audio"}
			</span>
		</span>
	);
}

export function MediaPreview({ asset }: { asset: GalleryAsset }) {
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	if (failed) {
		return (
			<div className="flex min-h-40 flex-col items-center justify-center gap-3">
				<p role="alert" className="text-muted-foreground text-sm">
					This file could not be loaded.
				</p>
				<Button
					variant="outline"
					onClick={() => {
						setFailed(false);
						setAttempt(attempt + 1);
					}}
				>
					Retry preview
				</Button>
			</div>
		);
	}
	const url = assetUrl(asset);
	if (assetKind(asset) === "Image") {
		return (
			<img
				key={attempt}
				src={url}
				alt={asset.name}
				className="max-h-[55dvh] w-full object-contain"
				onError={() => setFailed(true)}
			/>
		);
	}
	if (assetKind(asset) === "Video") {
		return (
			<video
				key={attempt}
				src={url}
				controls
				preload="metadata"
				className="max-h-[55dvh] w-full"
				aria-label={asset.name}
				onError={() => setFailed(true)}
			>
				<track kind="captions" />
			</video>
		);
	}
	return (
		<audio
			key={attempt}
			src={url}
			controls
			preload="metadata"
			className="w-full"
			aria-label={asset.name}
			onError={() => setFailed(true)}
		>
			<track kind="captions" />
		</audio>
	);
}

export function MediaDownload({ asset }: { asset: GalleryAsset }) {
	return (
		<a
			href={assetUrl(asset)}
			download={asset.name}
			className={buttonVariants({ variant: "outline", size: "sm" })}
			aria-label={`Download ${asset.name}`}
		>
			<DownloadIcon data-icon="inline-start" />
			Download
		</a>
	);
}
