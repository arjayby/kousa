"use client";

import { Button } from "@kousa/ui/components/button";
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
	DialogFooter,
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
import { Skeleton } from "@kousa/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplateIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { client, orpc } from "@/utils/orpc";
import { TemplateNameDialog } from "./template-name-dialog";

type Template = Awaited<ReturnType<typeof client.templates.list>>[number];
export function TemplateLibrary({ userId }: { userId: string }) {
	const [open, setOpen] = useState(false);
	const [action, setAction] = useState<{
		type: "use" | "rename" | "delete";
		template: Template;
	} | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const deletingRef = useRef(false);
	const router = useRouter();
	const cache = useQueryClient();
	const templates = useQuery({
		...orpc.templates.list.queryOptions(),
		queryKey: ["templates", userId],
		enabled: open,
		retry: false,
	});
	const refresh = () =>
		cache.invalidateQueries({ queryKey: ["templates", userId] });
	async function remove(templateId: string) {
		if (deletingRef.current) return;
		deletingRef.current = true;
		setDeleting(true);
		setDeleteError(null);
		try {
			await client.templates.remove({ templateId });
			setAction(null);
			void refresh();
		} catch (cause) {
			setDeleteError(
				cause instanceof Error
					? cause.message
					: "Could not delete template. Try again.",
			);
		} finally {
			deletingRef.current = false;
			setDeleting(false);
		}
	}
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!action) setOpen(value);
			}}
		>
			<DialogTrigger render={<Button variant="outline" />}>
				<LayoutTemplateIcon data-icon="inline-start" />
				My templates
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Workflow templates</DialogTitle>
					<DialogDescription>
						Your private workflow snapshots. Start a new project with the saved
						prompts and settings. No generation starts automatically.
					</DialogDescription>
				</DialogHeader>
				{templates.isPending ? (
					<Skeleton className="h-40 w-full" />
				) : templates.isError ? (
					<div role="alert">
						Could not load templates.{" "}
						<Button variant="link" onClick={() => void templates.refetch()}>
							Try again
						</Button>
					</div>
				) : templates.data.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No templates yet</EmptyTitle>
							<EmptyDescription>
								Open a project canvas and choose Save template to keep a
								workflow for later.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<section
						className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto"
						aria-label="Your templates"
					>
						{templates.data.map((template) => (
							<Card key={template.id}>
								<CardHeader>
									<CardTitle>
										<h3 className="break-words">{template.name}</h3>
									</CardTitle>
									<CardDescription>
										{template.nodeCount} nodes · {template.edgeCount}{" "}
										connections
									</CardDescription>
								</CardHeader>
								<CardContent>
									<p className="text-muted-foreground">
										Updated{" "}
										{new Intl.DateTimeFormat("en", {
											dateStyle: "medium",
											timeZone: "UTC",
										}).format(new Date(template.updatedAt))}
									</p>
								</CardContent>
								<CardFooter className="flex flex-wrap gap-2">
									<Button
										onClick={() => setAction({ type: "use", template })}
										aria-label={`Use ${template.name}`}
									>
										Use template
									</Button>
									<Button
										variant="outline"
										onClick={() => setAction({ type: "rename", template })}
										aria-label={`Rename ${template.name}`}
									>
										Rename
									</Button>
									<Button
										variant="ghost"
										onClick={() => {
											setDeleteError(null);
											setAction({ type: "delete", template });
										}}
										aria-label={`Delete ${template.name}`}
									>
										Delete
									</Button>
								</CardFooter>
							</Card>
						))}
					</section>
				)}
				{action?.type === "rename" ? (
					<TemplateNameDialog
						key={`rename-${action.template.id}`}
						title="Rename template"
						description="This changes the name in your library. The saved workflow stays the same."
						initialName={action.template.name}
						submitLabel="Save name"
						onClose={() => setAction(null)}
						onSave={async (name) => {
							await client.templates.rename({
								templateId: action.template.id,
								name,
							});
							void refresh();
						}}
					/>
				) : null}
				{action?.type === "use" ? (
					<TemplateNameDialog
						key={`use-${action.template.id}`}
						title="Create project from template"
						description={`${action.template.nodeCount} nodes and ${action.template.edgeCount} connections will be copied. The new project starts private, without media files or run history. Generation uses credits only when you run it.`}
						label="Project name"
						initialName={action.template.name}
						submitLabel="Create project"
						onClose={() => setAction(null)}
						onSave={async (name, id) => {
							const created = await client.templates.createProject({
								id,
								templateId: action.template.id,
								name,
							});
							void cache.invalidateQueries({
								queryKey: ["projects", userId],
								refetchType: "none",
							});
							setOpen(false);
							router.push(`/projects/${created.id}/canvas`);
						}}
					/>
				) : null}
				<Dialog
					open={action?.type === "delete"}
					onOpenChange={(value) => {
						if (!value && !deleting) setAction(null);
					}}
				>
					<DialogContent showCloseButton={!deleting}>
						<DialogHeader>
							<DialogTitle>Delete template?</DialogTitle>
							<DialogDescription>
								Remove {action?.template.name} from your library. Existing
								projects and their media will be kept.
							</DialogDescription>
						</DialogHeader>
						{deleteError ? <p role="alert">{deleteError}</p> : null}
						<DialogFooter>
							<Button
								variant="outline"
								disabled={deleting}
								onClick={() => setAction(null)}
							>
								Cancel
							</Button>
							<Button
								variant="destructive"
								disabled={deleting}
								onClick={() => {
									if (action) void remove(action.template.id);
								}}
							>
								{deleting ? "Deleting…" : "Delete template"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</DialogContent>
		</Dialog>
	);
}
