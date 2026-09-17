"use client";

import type { ProjectAsset, PublicAsset } from "@kousa/media/contracts";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import { Card, CardContent, CardFooter } from "@kousa/ui/components/card";
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
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kousa/ui/components/input-group";
import { Skeleton } from "@kousa/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import {
	FilmIcon,
	FolderOpenIcon,
	MicIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
} from "lucide-react";
import { useState } from "react";
import {
	AssetDownload,
	AssetPreview,
	AudioPreview,
	useCanvasMedia,
	VideoPreview,
} from "./canvas-media";

const filters = [
	{ value: "all", label: "All" },
	{ value: "image", label: "Images" },
	{ value: "video", label: "Videos" },
	{ value: "audio", label: "Speech" },
] as const;

function assetKind(asset: PublicAsset) {
	return asset.mimeType === "audio/mpeg"
		? "audio"
		: asset.mimeType === "video/mp4"
			? "video"
			: "image";
}
function assetDetails(asset: PublicAsset) {
	return [
		asset.mimeType.split("/")[1]?.toUpperCase(),
		asset.width && asset.height ? `${asset.width} × ${asset.height}` : null,
		asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} sec` : null,
		asset.bytes < 1024 * 1024
			? `${Math.max(1, Math.round(asset.bytes / 1024))} KB`
			: `${(asset.bytes / (1024 * 1024)).toFixed(1)} MB`,
	]
		.filter(Boolean)
		.join(" · ");
}

export function MediaLibrary({
	canEdit,
	atNodeLimit,
	onUseAsset,
}: {
	canEdit: boolean;
	atNodeLimit: boolean;
	onUseAsset: (asset: PublicAsset) => boolean;
}) {
	const media = useCanvasMedia();
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [previewId, setPreviewId] = useState<string | null>(null);
	const assets = media.error ? [] : media.assets;
	const query = search.trim().toLocaleLowerCase();
	const visible = assets.filter(
		(asset) =>
			(filter === "all" || assetKind(asset) === filter) &&
			asset.name.toLocaleLowerCase().includes(query),
	);
	const preview = assets.find((asset) => asset.id === previewId);
	function addAssetToCanvas(asset: ProjectAsset) {
		if (!canEdit || atNodeLimit) return;
		if (onUseAsset(asset)) {
			setPreviewId(null);
			setOpen(false);
		}
	}
	function reuseButton(asset: ProjectAsset) {
		return canEdit ? (
			<Button
				size="sm"
				variant="outline"
				disabled={atNodeLimit}
				onClick={() => addAssetToCanvas(asset)}
			>
				<PlusIcon data-icon="inline-start" /> Add to canvas
			</Button>
		) : null;
	}
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (value) void media.refresh();
				else setPreviewId(null);
			}}
		>
			<DialogTrigger render={<Button variant="ghost" />}>
				<FolderOpenIcon data-icon="inline-start" /> Media library
			</DialogTrigger>
			<DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col sm:max-w-4xl">
				<DialogHeader className="pr-8">
					<DialogTitle>Project media</DialogTitle>
					<DialogDescription>
						Uploaded and generated media, including finished clips. Files remain
						here when a node is deleted.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-center gap-3">
					<ToggleGroup
						aria-label="Media type"
						variant="outline"
						size="sm"
						spacing={0}
						value={[filter]}
						onValueChange={(values) => {
							if (values[0]) setFilter(values[0]);
						}}
					>
						{filters.map((item) => (
							<ToggleGroupItem key={item.value} value={item.value}>
								{item.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<InputGroup className="min-w-40 flex-1">
						<InputGroupAddon>
							<SearchIcon />
						</InputGroupAddon>
						<InputGroupInput
							aria-label="Search project media"
							placeholder="Search filenames…"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</InputGroup>
					<Button
						variant="ghost"
						size="icon"
						disabled={media.refreshing}
						aria-label="Refresh media"
						onClick={() => void media.refresh()}
					>
						<RefreshCwIcon
							className={media.refreshing ? "animate-spin" : undefined}
						/>
					</Button>
				</div>
				<div className="flex flex-wrap justify-between gap-2 text-muted-foreground">
					<p role="status">
						{media.pending
							? "Loading media…"
							: media.error
								? "Library unavailable"
								: `${visible.length} of ${assets.length} files`}
					</p>
					<p>
						{!canEdit
							? "View-only access · Preview and download"
							: atNodeLimit
								? "Canvas limit reached (200 nodes)"
								: "Add saved media as new canvas nodes."}
					</p>
				</div>
				<div
					className="min-h-0 overflow-y-auto overscroll-contain p-1"
					aria-busy={media.pending}
				>
					{media.error ? (
						<Alert variant="destructive">
							<AlertTitle>Could not load project media</AlertTitle>
							<AlertDescription>
								<p>
									Check your connection and project access, then try refreshing.
								</p>
								<Button
									variant="outline"
									disabled={media.refreshing}
									onClick={() => void media.refresh()}
								>
									Retry
								</Button>
							</AlertDescription>
						</Alert>
					) : media.pending ? (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{[1, 2, 3].map((key) => (
								<Skeleton key={key} className="h-60" />
							))}
						</div>
					) : visible.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>
									{assets.length ? "No matching media" : "No media yet"}
								</EmptyTitle>
								<EmptyDescription>
									{assets.length
										? "Try a different media type or filename."
										: "Upload an image from an Image node or generate media to start this library."}
								</EmptyDescription>
							</EmptyHeader>
							{assets.length > 0 ? (
								<Button
									variant="outline"
									onClick={() => {
										setFilter("all");
										setSearch("");
									}}
								>
									Clear filters
								</Button>
							) : null}
						</Empty>
					) : (
						<ul
							className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
							aria-label="Project media files"
						>
							{visible.map((asset) => {
								const kind = assetKind(asset);
								return (
									<li key={asset.id} className="min-w-0">
										<Card size="sm" className="h-full">
											<CardContent className="flex flex-1 flex-col gap-3">
												<button
													type="button"
													className="flex aspect-video w-full items-center justify-center overflow-hidden bg-muted/40 outline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&_img]:max-h-full"
													aria-label={`Preview ${asset.name}`}
													onClick={() => setPreviewId(asset.id)}
												>
													{kind === "image" ? (
														<AssetPreview assetId={asset.id} compact />
													) : kind === "video" ? (
														<FilmIcon className="size-10 text-muted-foreground" />
													) : (
														<MicIcon className="size-10 text-muted-foreground" />
													)}
												</button>
												<div>
													<p className="break-all font-medium">{asset.name}</p>
													<p className="text-muted-foreground">
														{assetDetails(asset)}
													</p>
												</div>
											</CardContent>
											<CardFooter className="flex-wrap justify-between gap-2">
												<AssetDownload assetId={asset.id} kind={kind} />
												{reuseButton(asset)}
											</CardFooter>
										</Card>
									</li>
								);
							})}
						</ul>
					)}
				</div>
				<Dialog
					open={Boolean(preview)}
					onOpenChange={(value) => {
						if (!value) setPreviewId(null);
					}}
				>
					<DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
						<DialogHeader className="pr-8">
							<DialogTitle className="break-all">
								{preview?.name ?? "Media preview"}
							</DialogTitle>
							<DialogDescription>
								{preview ? assetDetails(preview) : ""}
							</DialogDescription>
						</DialogHeader>
						{preview ? (
							<>
								{assetKind(preview) === "image" ? (
									<div className="[&_img]:max-h-[55dvh]">
										<AssetPreview assetId={preview.id} />
									</div>
								) : assetKind(preview) === "video" ? (
									<VideoPreview key={preview.id} assetId={preview.id} />
								) : (
									<AudioPreview
										key={preview.id}
										assetId={preview.id}
										transcript={preview.transcript}
									/>
								)}
								<div className="flex flex-wrap items-center justify-between gap-2">
									<AssetDownload
										assetId={preview.id}
										kind={assetKind(preview)}
									/>
									{reuseButton(preview)}
								</div>
							</>
						) : null}
					</DialogContent>
				</Dialog>
			</DialogContent>
		</Dialog>
	);
}
