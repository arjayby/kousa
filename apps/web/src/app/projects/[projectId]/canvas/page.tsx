import { createAuth } from "@kousa/auth";
import { canvasIdInput } from "@kousa/projects/contracts";
import { createProjects } from "@kousa/projects/runtime";
import { ProjectError } from "@kousa/projects/service";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProjectCanvas } from "@/components/canvas/project-canvas";

export default async function CanvasPage({
	params,
	searchParams,
}: {
	params: Promise<{ projectId: string }>;
	searchParams: Promise<{ canvas?: string | string[] }>;
}) {
	const input = canvasIdInput.safeParse({
		...(await params),
		canvasId: (await searchParams).canvas,
	});
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
	const canvases = await createProjects().listCanvases(
		session.user.id,
		input.data,
	);
	const canvasId = input.data.canvasId ?? project.id;
	if (!canvases.some((canvas) => canvas.id === canvasId)) notFound();
	return (
		<ProjectCanvas
			userId={session.user.id}
			initialProject={project}
			canvasId={canvasId}
			initialCanvases={canvases}
		/>
	);
}
