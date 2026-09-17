import { createAuth } from "@kousa/auth";
import { projectIdInput } from "@kousa/projects/contracts";
import { createProjects } from "@kousa/projects/runtime";
import { ProjectError } from "@kousa/projects/service";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProjectCanvas } from "@/components/canvas/project-canvas";

export default async function CanvasPage({
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
	const project = await createProjects()
		.get(session.user.id, input.data)
		.catch((error) => {
			if (error instanceof ProjectError && error.code === "NOT_FOUND")
				notFound();
			throw error;
		});
	return <ProjectCanvas userId={session.user.id} initialProject={project} />;
}
