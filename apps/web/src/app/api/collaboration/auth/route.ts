import { createAuth } from "@kousa/auth";
import { createCollaboration } from "@kousa/projects/runtime";
import { ProjectError } from "@kousa/projects/service";
import { z } from "zod";

const inputSchema = z
	.object({
		room: z.string().regex(/^kousa-[0-9a-f-]{36}$/),
		projectId: z.uuid().optional(),
	})
	.strict();
const responseHeaders = {
	"Cache-Control": "no-store",
	"Content-Type": "application/json",
};
export async function POST(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin)
		return Response.json(
			{ error: "forbidden" },
			{ status: 403, headers: responseHeaders },
		);
	const session = await createAuth().api.getSession({
		headers: request.headers,
	});
	if (!session?.user)
		return Response.json(
			{ error: "forbidden" },
			{ status: 401, headers: responseHeaders },
		);
	try {
		const { room, projectId } = inputSchema.parse(await request.json());
		const result = await createCollaboration().join(session.user, {
			projectId: projectId ?? room.slice(6),
			canvasId: room.slice(6),
		});
		return Response.json(
			{ ...JSON.parse(result.body), userId: session.user.id },
			{ status: result.status, headers: responseHeaders },
		);
	} catch (error) {
		if (error instanceof z.ZodError || error instanceof SyntaxError)
			return Response.json(
				{ error: "Invalid room" },
				{ status: 400, headers: responseHeaders },
			);
		const status =
			error instanceof ProjectError
				? {
						NOT_FOUND: 404,
						FORBIDDEN: 403,
						CONFLICT: 409,
						SERVICE_UNAVAILABLE: 503,
						INVALID_INVITE: 404,
						EMAIL_NOT_VERIFIED: 403,
					}[error.code]
				: 503;
		return Response.json(
			{
				error: status === 403 || status === 404 ? "forbidden" : "unavailable",
				message:
					error instanceof ProjectError
						? error.message
						: "Live collaboration could not connect. Please retry.",
			},
			{ status, headers: responseHeaders },
		);
	}
}
