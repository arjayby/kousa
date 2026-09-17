import { handleMedia } from "@/lib/media-handler";

export async function GET(
	request: Request,
	context: RouteContext<"/api/projects/[projectId]/media/[assetId]">,
) {
	return handleMedia(request, await context.params);
}
