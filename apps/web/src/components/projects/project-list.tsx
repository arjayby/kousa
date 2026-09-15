"use client";

import type { ProjectList } from "@kousa/projects/service";
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
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import { Skeleton } from "@kousa/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { client, orpc } from "@/utils/orpc";
import { ProjectNameForm } from "./project-name-form";

export function ProjectListPanel({
	userId,
	initialProjects,
}: {
	userId: string;
	initialProjects: ProjectList;
}) {
	const router = useRouter();
	const cache = useQueryClient();
	const [offset, setOffset] = useState(0);
	const projects = useQuery({
		...orpc.projects.list.queryOptions({ input: { offset } }),
		queryKey: ["projects", userId, "list", offset],
		initialData: offset === 0 ? initialProjects : undefined,
	});
	return (
		<section
			aria-labelledby="projects-title"
			className="flex min-w-0 flex-col gap-6"
		>
			<Card>
				<CardHeader>
					<CardTitle>
						<h2 id="projects-title">Projects</h2>
					</CardTitle>
					<CardDescription>
						Create a private project, then invite people to work with you.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ProjectNameForm
						submitLabel="Create project"
						onSave={async (name) => {
							const created = await client.projects.create({ name });
							await cache.invalidateQueries({
								queryKey: ["projects", userId, "list"],
								refetchType: "none",
							});
							router.push(`/projects/${created.id}`);
						}}
					/>
				</CardContent>
			</Card>
			{projects.isError ? (
				<p role="alert">
					Could not load your projects.{" "}
					<Button variant="link" onClick={() => projects.refetch()}>
						Try again
					</Button>
				</p>
			) : projects.isPending ? (
				<Skeleton className="h-40 w-full" />
			) : projects.data.items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No projects yet</EmptyTitle>
						<EmptyDescription>
							Create your first project above, or accept an invitation to a
							shared project.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{projects.data.items.map((project) => (
						<Card key={project.id}>
							<CardHeader>
								<CardTitle>
									<h3 className="break-words">{project.name}</h3>
								</CardTitle>
								<CardDescription>
									Updated{" "}
									{new Intl.DateTimeFormat("en", {
										dateStyle: "medium",
										timeZone: "UTC",
									}).format(new Date(project.updatedAt))}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Badge variant="secondary">{project.role}</Badge>
							</CardContent>
							<CardFooter>
								<Link
									href={`/projects/${project.id}`}
									className={buttonVariants({ variant: "outline" })}
									aria-label={`Open ${project.name}`}
								>
									Open project
								</Link>
							</CardFooter>
						</Card>
					))}
				</div>
			)}
			{(offset > 0 || projects.data?.hasMore) && (
				<nav aria-label="Project pages" className="flex items-center gap-3">
					<Button
						variant="outline"
						disabled={offset === 0 || projects.isFetching}
						onClick={() => setOffset((value) => Math.max(0, value - 20))}
					>
						Previous
					</Button>
					<span className="text-muted-foreground text-sm">
						Page {offset / 20 + 1}
					</span>
					<Button
						variant="outline"
						disabled={!projects.data?.hasMore || projects.isFetching}
						onClick={() => setOffset((value) => value + 20)}
					>
						Next
					</Button>
				</nav>
			)}
		</section>
	);
}
