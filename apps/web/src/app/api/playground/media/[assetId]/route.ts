import { createAuth } from "@kousa/auth";
import { createMediaHandler } from "@kousa/media/http";
import { createMedia } from "@kousa/media/runtime";

const handle = createMediaHandler({
	personal: true,
	service: createMedia,
	async actor(request) {
		const session = await createAuth().api.getSession({
			headers: request.headers,
		});
		return session?.user.id ?? null;
	},
});
export async function GET(
	request: Request,
	context: { params: Promise<{ assetId: string }> },
) {
	return handle(request, await context.params);
}
export const HEAD = GET;
