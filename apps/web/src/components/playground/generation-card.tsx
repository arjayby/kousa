"use client";

import { isRunActive, runProgress } from "@kousa/generation/contracts";
import {
	playgroundMediaUrl,
	playgroundModels,
} from "@kousa/generation/playground-contracts";
import type { PlaygroundRun } from "@kousa/generation/playground-service";
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
	CopyIcon,
	DownloadIcon,
	LoaderCircleIcon,
	PlusIcon,
	RotateCcwIcon,
} from "lucide-react";
import { useState } from "react";

export function GenerationCard({
	run,
	onReuse,
	onAdd,
}: {
	run: PlaygroundRun;
	onReuse: () => void;
	onAdd: () => void;
}) {
	const [message, setMessage] = useState("");
	const model =
		playgroundModels[run.kind].find((m) => m.id === run.modelId)?.name ??
		run.modelId;
	const active = isRunActive(run);
	const url = run.assetId ? playgroundMediaUrl(run.assetId) : null;
	return (
		<Card className="min-w-0">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>{model}</CardTitle>
					<Badge
						variant={run.status === "failed" ? "destructive" : "secondary"}
					>
						{active
							? runProgress(run)
							: run.status === "succeeded"
								? "Completed"
								: run.status === "failed"
									? "Failed"
									: "Cancelled"}
					</Badge>
				</div>
				<CardDescription>
					{run.createdAt.slice(0, 16).replace("T", " ")} UTC · {run.credits}{" "}
					{active
						? `${run.credits === 1 ? "credit" : "credits"} reserved`
						: run.status === "succeeded"
							? run.credits === 1
								? "credit"
								: "credits"
							: `${run.credits === 1 ? "credit" : "credits"} released`}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{active ? (
					<div
						role="status"
						className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground"
					>
						<LoaderCircleIcon className="size-5 animate-spin" />
						{runProgress(run)}
					</div>
				) : null}
				{run.output ? (
					<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
						{run.output}
					</pre>
				) : null}
				{url && run.kind === "image" ? (
					<img
						src={url}
						alt={run.prompt}
						loading="lazy"
						className="max-h-80 w-full object-contain"
					/>
				) : null}
				{url && run.kind === "video" ? (
					<video
						src={url}
						controls
						preload="none"
						className="max-h-80 w-full"
						aria-label="Generated video"
					>
						<track kind="captions" />
					</video>
				) : null}
				{url && run.kind === "speech" ? (
					<audio
						src={url}
						controls
						preload="none"
						className="w-full"
						aria-label="Generated audio"
					>
						<track kind="captions" />
					</audio>
				) : null}
				{run.error ? (
					<p role="alert" className="text-destructive text-sm">
						{run.error}
					</p>
				) : null}
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						{run.kind === "speech"
							? "Script and settings"
							: "Prompt and settings"}
					</summary>
					<div className="mt-3 flex flex-col gap-2">
						<p className="whitespace-pre-wrap break-words">{run.prompt}</p>
						{"aspectRatio" in run.settings ? (
							<p className="text-muted-foreground">
								Aspect ratio: {run.settings.aspectRatio}
							</p>
						) : null}
						{"duration" in run.settings ? (
							<p className="text-muted-foreground">
								Duration: {run.settings.duration} seconds
							</p>
						) : null}
						{run.settings.kind === "image" && run.settings.imageQuality ? (
							<p className="text-muted-foreground">
								Quality: {run.settings.imageQuality}
							</p>
						) : null}
						{"voiceDirection" in run.settings && run.settings.voiceDirection ? (
							<p className="text-muted-foreground">
								Voice direction: {run.settings.voiceDirection}
							</p>
						) : null}
					</div>
				</details>
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				<Button variant="ghost" size="sm" onClick={onReuse}>
					<RotateCcwIcon data-icon="inline-start" />
					Use prompt
				</Button>
				{run.output ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(run.output ?? "");
								setMessage("Copied");
							} catch {
								setMessage("Select the result to copy it manually.");
							}
						}}
					>
						<CopyIcon data-icon="inline-start" />
						Copy
					</Button>
				) : null}
				{run.output ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							const href = URL.createObjectURL(
								new Blob([run.output ?? ""], {
									type: "text/plain;charset=utf-8",
								}),
							);
							const anchor = document.createElement("a");
							anchor.href = href;
							anchor.download = `kousa-${run.id}.txt`;
							anchor.click();
							setTimeout(() => URL.revokeObjectURL(href), 1000);
						}}
					>
						<DownloadIcon data-icon="inline-start" />
						Download
					</Button>
				) : null}
				{url ? (
					<a
						href={url}
						download
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<DownloadIcon data-icon="inline-start" />
						Download
					</a>
				) : null}
				{run.status === "succeeded" ? (
					<Button variant="outline" size="sm" onClick={onAdd}>
						<PlusIcon data-icon="inline-start" />
						Add to canvas
					</Button>
				) : null}
				{message ? (
					<p role="status" className="w-full text-muted-foreground text-xs">
						{message}
					</p>
				) : null}
			</CardFooter>
		</Card>
	);
}
