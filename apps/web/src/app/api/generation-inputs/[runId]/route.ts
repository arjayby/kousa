import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { env } from "@kousa/env/server";
import { createGenerationImageAccess } from "@kousa/generation/image-access";
import { createMedia } from "@kousa/media/runtime";

export async function GET(
	request: Request,
	context: { params: Promise<{ runId: string }> },
) {
	const { runId } = await context.params;
	if (new URL(request.url).searchParams.has("media")) {
		const response = await env.GENERATION_JOBS.fetch(
			`https://jobs.internal/generation-inputs/${encodeURIComponent(runId)}${new URL(request.url).search}`,
			{ method: request.method, signal: AbortSignal.timeout(180_000) },
		);
		return new Response(response.body, {
			status: response.status,
			headers: response.headers,
		});
	}
	return createGenerationImageAccess(
		createGenerationStore(createDb()),
		createMedia(),
	).handle(request, runId);
}

export const HEAD = GET;
