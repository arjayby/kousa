"use client";

import type { GalleryInput, GalleryPage } from "@kousa/media/gallery-contracts";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Badge } from "@kousa/ui/components/badge";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import { Field, FieldLabel } from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { Skeleton } from "@kousa/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ImagesIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { client } from "@/utils/orpc";
import {
	assetDetails,
	assetKind,
	MediaDownload,
	MediaPreview,
	MediaThumbnail,
} from "./media-asset";

const filters = [
	{ value: "all", label: "All media" },
	{ value: "image", label: "Images" },
	{ value: "video", label: "Videos" },
	{ value: "speech", label: "Speech" },
] as const;

export function MediaGallery({
	userId,
	initial,
}: {
	userId: string;
	initial: GalleryPage;
}) {
	const [kind, setKind] = useState<NonNullable<GalleryInput["kind"]>>("all");
	const [searchText, setSearchText] = useState("");
	const [search, setSearch] = useState("");
	const [previewId, setPreviewId] = useState<string | null>(null);
	const query = useInfiniteQuery({
		queryKey: ["generated-media", userId, kind, search],
		queryFn: ({ pageParam, signal }) =>
			client.media.list({ kind, search, cursor: pageParam }, { signal }),
		initialPageParam: undefined as GalleryInput["cursor"],
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		initialData:
			kind === "all" && !search
				? { pages: [initial], pageParams: [undefined] }
				: undefined,
		staleTime: 10_000,
		retry: false,
	});
	// Hide stale metadata after a failed refresh, including revoked access.
	const assets =
		query.isError && !query.isFetchNextPageError
			? []
			: (query.data?.pages.flatMap((page) => page.assets) ?? []);
	const preview = assets.find((asset) => asset.id === previewId);
	const filtered = kind !== "all" || Boolean(search);
	function clearFilters() {
		setKind("all");
		setSearch("");
		setSearchText("");
	}

	return (
		<main className="container mx-auto flex min-w-0 flex-col gap-6 px-4 py-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h1 className="font-semibold text-2xl">Media</h1>
					<p className="text-muted-foreground">
						Generated images, videos, and speech from your playground and
						projects.
					</p>
				</div>
				<Link href="/playground" className={buttonVariants()}>
					Generate media
				</Link>
			</div>

			<div className="flex flex-wrap items-end justify-between gap-4">
				<ToggleGroup
					value={[kind]}
					onValueChange={(values) => {
						const selected = filters.find(
							(filter) => filter.value === values[0],
						);
						if (selected) setKind(selected.value);
					}}
					variant="outline"
					spacing={0}
					aria-label="Media type"
				>
					{filters.map((filter) => (
						<ToggleGroupItem key={filter.value} value={filter.value}>
							{filter.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<search className="w-full sm:w-auto">
					<form
						className="flex w-full items-end gap-2 sm:w-auto"
						onSubmit={(event) => {
							event.preventDefault();
							setSearch(searchText.trim());
						}}
					>
						<Field className="min-w-0 flex-1 sm:w-72">
							<FieldLabel htmlFor="media-search">Search media</FieldLabel>
							<Input
								id="media-search"
								type="search"
								placeholder="Filename or project name"
								maxLength={200}
								value={searchText}
								onChange={(event) => {
									setSearchText(event.target.value);
									if (!event.target.value) setSearch("");
								}}
							/>
						</Field>
						<Button type="submit" variant="outline">
							<SearchIcon data-icon="inline-start" />
							Search
						</Button>
					</form>
				</search>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<p role="status" className="text-muted-foreground text-sm">
					{query.isPending
						? "Loading media…"
						: `${assets.length}${query.hasNextPage ? "+" : ""} ${assets.length === 1 && !query.hasNextPage ? "file" : "files"} · Newest first`}
				</p>
				{filtered ? (
					<Button variant="ghost" size="sm" onClick={clearFilters}>
						Clear filters
					</Button>
				) : null}
			</div>

			{query.isError ? (
				<Alert variant="destructive">
					<AlertTitle>
						{query.isFetchNextPageError
							? "Could not load more media"
							: "Could not load your media"}
					</AlertTitle>
					<AlertDescription>
						<Button
							variant="outline"
							size="sm"
							disabled={query.isFetching}
							onClick={() =>
								void (query.isFetchNextPageError
									? query.fetchNextPage()
									: query.refetch())
							}
						>
							Try again
						</Button>
					</AlertDescription>
				</Alert>
			) : null}
			{query.isPending ? (
				<div
					className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
					aria-busy="true"
				>
					{[1, 2, 3, 4].map((id) => (
						<Skeleton key={id} className="aspect-square w-full" />
					))}
				</div>
			) : !query.isError && assets.length === 0 ? (
				<Empty className="min-h-64 border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ImagesIcon />
						</EmptyMedia>
						<EmptyTitle>
							{filtered ? "No matching media" : "No generated media yet"}
						</EmptyTitle>
						<EmptyDescription>
							{filtered
								? "Try another search or media type."
								: "Your completed images, videos, speech, and narrated clips will appear here."}
						</EmptyDescription>
					</EmptyHeader>
					{filtered ? (
						<Button variant="outline" onClick={clearFilters}>
							Show all media
						</Button>
					) : (
						<Link href="/playground" className={buttonVariants()}>
							Open playground
						</Link>
					)}
				</Empty>
			) : assets.length > 0 ? (
				<ul
					className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
					aria-label="Generated media files"
				>
					{assets.map((asset) => (
						<li key={asset.id} className="min-w-0">
							<Card className="h-full">
								<CardContent>
									<button
										type="button"
										className="flex aspect-video w-full items-center justify-center overflow-hidden bg-muted/40 outline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
										aria-label={`Preview ${asset.name}`}
										onClick={() => setPreviewId(asset.id)}
									>
										<MediaThumbnail asset={asset} />
									</button>
								</CardContent>
								<CardHeader className="flex-1">
									<div className="mb-1">
										<Badge variant="secondary">{assetKind(asset)}</Badge>
									</div>
									<CardTitle className="break-all">{asset.name}</CardTitle>
									<CardDescription>{assetDetails(asset)}</CardDescription>
									<CardDescription>
										<Link
											href={
												asset.projectId
													? `/projects/${asset.projectId}`
													: "/playground"
											}
											className="break-words underline underline-offset-4"
										>
											{asset.projectName ?? "Playground"}
										</Link>
										{" · "}
										<time dateTime={asset.createdAt}>
											{asset.createdAt.slice(0, 10)}
										</time>
									</CardDescription>
								</CardHeader>
								<CardFooter className="flex-wrap justify-between gap-2">
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setPreviewId(asset.id)}
									>
										Preview
									</Button>
									<MediaDownload asset={asset} />
								</CardFooter>
							</Card>
						</li>
					))}
				</ul>
			) : null}
			{query.hasNextPage ? (
				<div className="flex justify-center">
					<Button
						variant="outline"
						disabled={query.isFetching}
						onClick={() => void query.fetchNextPage()}
					>
						{query.isFetchingNextPage ? "Loading…" : "Load more media"}
					</Button>
				</div>
			) : null}
			<Dialog
				open={Boolean(preview)}
				onOpenChange={(open) => {
					if (!open) setPreviewId(null);
				}}
			>
				<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
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
							<MediaPreview key={preview.id} asset={preview} />
							{preview.transcript ? (
								<div className="flex flex-col gap-2">
									<h2 className="font-medium text-sm">Transcript</h2>
									<p className="whitespace-pre-wrap break-words text-sm">
										{preview.transcript}
									</p>
								</div>
							) : null}
							<div className="flex flex-wrap items-center justify-between gap-2">
								<Link
									href={
										preview.projectId
											? `/projects/${preview.projectId}`
											: "/playground"
									}
									className={buttonVariants({ variant: "ghost", size: "sm" })}
								>
									{preview.projectId ? "Open project" : "Open playground"}
								</Link>
								<MediaDownload asset={preview} />
							</div>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</main>
	);
}
