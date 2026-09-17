"use client";

import type { ProjectDetails } from "@kousa/projects/service";
import { Badge } from "@kousa/ui/components/badge";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import { Skeleton } from "@kousa/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeftIcon,
	ChevronRightIcon,
	LockKeyholeIcon,
	Settings2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const CanvasEditor = dynamic(() => import("./canvas-editor"), {
	ssr: false,
	loading: () => (
		<div
			className="flex min-h-0 flex-1 flex-col gap-3 p-4"
			role="status"
			aria-label="Loading canvas"
		>
			<Skeleton className="h-10 w-full" />
			<Skeleton className="min-h-64 flex-1" />
		</div>
	),
});

export function ProjectCanvas({
	userId,
	initialProject,
}: {
	userId: string;
	initialProject: ProjectDetails;
}) {
	const session = authClient.useSession();
	const query = useQuery({
		...orpc.projects.get.queryOptions({
			input: { projectId: initialProject.id },
		}),
		queryKey: ["projects", userId, "detail", initialProject.id],
		initialData: initialProject,
		retry: false,
		refetchInterval: 30_000,
	});
	if (query.isError || (!session.isPending && session.data?.user.id !== userId))
		return (
			<main className="flex flex-col items-center justify-center gap-4 p-8">
				<LockKeyholeIcon className="size-6 text-muted-foreground" />
				<h1 className="font-semibold text-xl">Canvas unavailable</h1>
				<p role="alert">
					Your account or project access has changed. Reload to check your
					access.
				</p>
				<Button onClick={() => window.location.reload()}>Reload project</Button>
				<Link href="/dashboard" className="underline">
					Back to projects
				</Link>
			</main>
		);
	const project = query.data;
	return (
		<main className="studio-page">
			<header className="studio-project-header">
				<Link
					href="/dashboard"
					aria-label="Back to projects"
					className={buttonVariants({ variant: "ghost", size: "icon" })}
				>
					<ArrowLeftIcon className="size-4" />
				</Link>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Link
						href={`/projects/${project.id}`}
						className="truncate text-muted-foreground text-xs hover:text-foreground"
					>
						{project.name}
					</Link>
					<ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
					<h1 className="font-medium text-sm">Canvas</h1>
				</div>
				<Badge variant="secondary">
					{project.permissions.canEdit ? project.role : "View only"}
				</Badge>
				<Link
					href={`/projects/${project.id}`}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					<Settings2Icon data-icon="inline-start" />
					Project settings
				</Link>
			</header>
			<CanvasEditor
				key={`${userId}:${project.id}`}
				userId={userId}
				projectId={project.id}
				canEdit={project.permissions.canEdit}
			/>
		</main>
	);
}
