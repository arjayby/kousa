import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { createGenerationImageAccess } from "@kousa/generation/image-access";
import { createMedia } from "@kousa/media/runtime";

export async function GET(
	request: Request,
	context: { params: Promise<{ runId: string }> },
) {
	const { runId } = await context.params;
	return createGenerationImageAccess(
		createGenerationStore(createDb()),
		createMedia(),
	).handle(request, runId);
}

export const HEAD = GET;
