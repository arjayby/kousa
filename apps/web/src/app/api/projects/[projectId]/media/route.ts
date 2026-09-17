import { handleMedia } from "@/lib/media-handler";

export async function GET(
	request: Request,
	context: RouteContext<"/api/projects/[projectId]/media">,
) {
	return handleMedia(request, await context.params);
}
export const POST = GET;
