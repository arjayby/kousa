import { createAuth } from "@kousa/auth";
import { projectIdInput } from "@kousa/projects/contracts";
import { createProjects } from "@kousa/projects/runtime";
import { ProjectError } from "@kousa/projects/service";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProjectDetailsPanel } from "@/components/projects/project-details";

export default async function ProjectPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const input = projectIdInput.safeParse(await params);
	if (!input.success) notFound();
	const session = await createAuth().api.getSession({
		headers: await headers(),
	});
	if (!session?.user) redirect("/login");
	const details = await createProjects()
		.get(session.user.id, input.data)
		.catch((error) => {
			if (error instanceof ProjectError && error.code === "NOT_FOUND")
				notFound();
			throw error;
		});
	return (
		<ProjectDetailsPanel userId={session.user.id} initialProject={details} />
	);
}
