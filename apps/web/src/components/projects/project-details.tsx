"use client";

import type { ProjectDetails } from "@kousa/projects/service";
import { Badge } from "@kousa/ui/components/badge";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { client, orpc } from "@/utils/orpc";
import { ProjectAccessPanel } from "./project-access";
import { ProjectNameForm } from "./project-name-form";

export function ProjectDetailsPanel({
	userId,
	initialProject,
}: {
	userId: string;
	initialProject: ProjectDetails;
}) {
	const cache = useQueryClient();
	const queryKey = ["projects", userId, "detail", initialProject.id];
	const query = useQuery({
		...orpc.projects.get.queryOptions({
			input: { projectId: initialProject.id },
		}),
		queryKey,
		initialData: initialProject,
		retry: false,
	});
	// Do not leave cached project content on screen after an access check fails.
	if (query.isError)
		return (
			<main className="container mx-auto flex flex-col gap-4 px-4 py-8">
				<h1 className="font-semibold text-2xl">Project unavailable</h1>
				<p role="alert">
					Your access may have changed, or the project could not be loaded.
				</p>
				<div className="flex gap-3">
					<Link
						href="/dashboard"
						className={buttonVariants({ variant: "outline" })}
					>
						Back to projects
					</Link>
					<Button onClick={() => query.refetch()}>Try again</Button>
				</div>
			</main>
		);
	const project = query.data;
	return (
		<main className="container mx-auto flex flex-col gap-6 px-4 py-8">
			<Link
				href="/dashboard"
				className="w-fit text-muted-foreground text-sm underline underline-offset-4"
			>
				Back to projects
			</Link>
			<header className="flex flex-wrap items-center gap-3">
				<h1 className="break-words font-semibold text-2xl">{project.name}</h1>
				<Badge variant="secondary">{project.role}</Badge>
			</header>
			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>
							<h2>Project details</h2>
						</CardTitle>
						<CardDescription>
							{project.permissions.canEdit
								? "Give this project a name you can find later."
								: "You have view-only access to this project."}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{project.permissions.canEdit ? (
							<ProjectNameForm
								key={project.name}
								initialName={project.name}
								submitLabel="Save name"
								onSave={async (name) => {
									await client.projects.rename({ projectId: project.id, name });
									await Promise.all([
										cache.invalidateQueries({ queryKey }),
										cache.invalidateQueries({
											queryKey: ["projects", userId, "list"],
										}),
									]);
								}}
							/>
						) : (
							<p>{project.name}</p>
						)}
					</CardContent>
				</Card>
				{project.permissions.canManageAccess ? (
					<ProjectAccessPanel userId={userId} projectId={project.id} />
				) : (
					<Card>
						<CardHeader>
							<CardTitle>
								<h2>Project access</h2>
							</CardTitle>
							<CardDescription>
								The owner manages collaborators and invitations.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p>
								{project.role === "editor"
									? "You can rename this project. You cannot change anyone’s access."
									: "You can open this project. Changes are restricted to the owner and editors."}
							</p>
						</CardContent>
					</Card>
				)}
			</div>
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Project ready</EmptyTitle>
					<EmptyDescription>
						Your project and permissions are saved. The node canvas is the next
						step.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</main>
	);
}
