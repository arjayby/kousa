"use client";

import type { ProjectService } from "@kousa/projects/service";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@kousa/ui/components/field";
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
import { PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { client, orpc } from "@/utils/orpc";

export type CanvasList = Awaited<ReturnType<ProjectService["listCanvases"]>>;
export const canvasHref = (projectId: string, canvasId: string) =>
	`/projects/${projectId}/canvas?canvas=${canvasId}` as const;

export function ProjectCanvases({
	userId,
	projectId,
	canEdit,
	canvasId,
	initialCanvases,
}: {
	userId: string;
	projectId: string;
	canEdit: boolean;
	canvasId?: string;
	initialCanvases?: CanvasList;
}) {
	const router = useRouter();
	const cache = useQueryClient();
	const queryKey = ["projects", userId, "canvases", projectId];
	const query = useQuery({
		...orpc.projects.listCanvases.queryOptions({ input: { projectId } }),
		queryKey,
		initialData: initialCanvases,
		retry: false,
		refetchInterval: 30_000,
	});
	const [dialog, setDialog] = useState<{ id?: string; name: string } | null>(
		null,
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const canvases = query.data ?? [];
	const selected = canvases.find((canvas) => canvas.id === canvasId);
	const open = (value: { id?: string; name: string }) => {
		setError(null);
		setDialog(value);
	};
	const add = canEdit ? (
		<Button variant="outline" size="sm" onClick={() => open({ name: "" })}>
			<PlusIcon data-icon="inline-start" />
			New canvas
		</Button>
	) : null;
	const rename = (canvas: CanvasList[number]) =>
		canEdit ? (
			<Button
				variant="ghost"
				size="icon"
				aria-label={`Rename ${canvas.name}`}
				onClick={() => open(canvas)}
			>
				<PencilIcon />
			</Button>
		) : null;
	const problem = query.isError ? (
		<p role="alert" className="text-destructive text-sm">
			Could not load canvases.{" "}
			<Button variant="outline" size="sm" onClick={() => void query.refetch()}>
				Retry
			</Button>
		</p>
	) : null;
	return (
		<>
			{canvasId ? (
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<h1 className="sr-only">{selected?.name ?? "Canvas"}</h1>
					<Select
						value={canvasId}
						items={canvases.map((canvas) => ({
							value: canvas.id,
							label: canvas.name,
						}))}
						onValueChange={(value) => {
							if (value && value !== canvasId)
								router.push(canvasHref(projectId, value));
						}}
					>
						<SelectTrigger aria-label="Switch canvas" className="max-w-56">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{canvases.map((canvas) => (
									<SelectItem key={canvas.id} value={canvas.id}>
										{canvas.name}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					{selected ? rename(selected) : null}
					{add}
					{problem}
				</div>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Canvases</CardTitle>
						<CardDescription>
							Separate workflows in one project. Members and media are shared
							across canvases.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{problem}
						{query.isPending ? <p role="status">Loading canvases…</p> : null}
						{!query.isError
							? canvases.map((canvas) => (
									<div key={canvas.id} className="flex items-center gap-2">
										<Link
											className={buttonVariants({
												variant: "outline",
												className: "min-w-0 flex-1 justify-start",
											})}
											href={canvasHref(projectId, canvas.id)}
										>
											<span className="truncate">{canvas.name}</span>
										</Link>
										{rename(canvas)}
									</div>
								))
							: null}
						{add}
					</CardContent>
				</Card>
			)}
			<Dialog
				open={dialog !== null}
				onOpenChange={(value) => {
					if (!value && !pending) setDialog(null);
				}}
			>
				<DialogContent showCloseButton={!pending}>
					<DialogHeader>
						<DialogTitle>
							{dialog?.id ? "Rename canvas" : "New canvas"}
						</DialogTitle>
						<DialogDescription>
							{dialog?.id
								? "Choose a name for this canvas."
								: "Start an empty canvas in this project."}
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (!dialog || pending || !canEdit) return;
							setPending(true);
							setError(null);
							try {
								const result = dialog.id
									? await client.projects.renameCanvas({
											projectId,
											canvasId: dialog.id,
											name: dialog.name,
										})
									: await client.projects.createCanvas({
											projectId,
											name: dialog.name,
										});
								await cache.invalidateQueries({ queryKey });
								setDialog(null);
								if (!dialog.id) router.push(canvasHref(projectId, result.id));
							} catch (cause) {
								setError(
									cause instanceof Error
										? cause.message
										: "Could not save canvas.",
								);
							} finally {
								setPending(false);
							}
						}}
					>
						<FieldGroup>
							<Field data-invalid={!!error}>
								<FieldLabel htmlFor="canvas-name">Canvas name</FieldLabel>
								<Input
									id="canvas-name"
									autoFocus
									required
									maxLength={120}
									disabled={pending}
									aria-invalid={!!error}
									value={dialog?.name ?? ""}
									placeholder="e.g. Product launch"
									onChange={(event) =>
										setDialog((current) =>
											current ? { ...current, name: event.target.value } : null,
										)
									}
								/>
							</Field>
						</FieldGroup>
						{error ? (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => setDialog(null)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={pending || !dialog?.name.trim()}>
								{pending
									? "Saving…"
									: dialog?.id
										? "Save name"
										: "Create canvas"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
