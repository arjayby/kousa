import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { env } from "@kousa/env/server";
import { createProjects } from "@kousa/projects/runtime";
import { createGenerationService } from "./service";

export function createGeneration() {
	const configured = Boolean(
		env.AI_GATEWAY_API_KEY?.trim() && env.GENERATION_JOBS,
	);
	return createGenerationService(
		createGenerationStore(createDb()),
		createProjects(),
		{
			textConfigured: configured,
			imageConfigured: configured,
			speechConfigured: configured,
			videoConfigured: configured,
			async dispatch(id) {
				// Pass a URL and init across the Node/Miniflare boundary: its fetcher
				// cannot recognize Node's Request object as its own Request class.
				const response = await env.GENERATION_JOBS.fetch(
					`https://jobs.internal/runs/${id}`,
					{
						method: "POST",
						signal: AbortSignal.timeout(5_000),
					},
				);
				if (!response.ok) throw new Error("Job dispatch unavailable");
			},
		},
	);
}
