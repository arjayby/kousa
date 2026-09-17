import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { createGraphStore } from "@kousa/db/graph-store";
import { env } from "@kousa/env/server";
import { createProjects } from "@kousa/projects/runtime";
import { createGraphService } from "./graph-service";

export function createGraphs() {
	const db = createDb();
	return createGraphService(
		createGraphStore(db),
		createGenerationStore(db),
		createProjects(),
		{
			configured: Boolean(
				env.AI_GATEWAY_API_KEY?.trim() && env.GENERATION_JOBS,
			),
			async dispatch(id) {
				const response = await env.GENERATION_JOBS.fetch(
					`https://jobs.internal/runs/${id}`,
					{ method: "POST", signal: AbortSignal.timeout(5_000) },
				);
				if (!response.ok) throw new Error("Job dispatch unavailable");
			},
		},
	);
}
