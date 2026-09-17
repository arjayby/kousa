import { createDb } from "@kousa/db";
import { createClipStore } from "@kousa/db/clip-store";
import { createGenerationStore } from "@kousa/db/generation-store";
import { createMediaStore } from "@kousa/db/media-store";
import { env } from "@kousa/env/server";
import { createProjects } from "@kousa/projects/runtime";
import { createClipService } from "./clip-service";
export function createClips() {
	const db = createDb();
	return createClipService(
		createClipStore(db),
		createGenerationStore(db),
		createMediaStore(db),
		createProjects(),
		{
			async configured() {
				try {
					const res = await env.GENERATION_JOBS.fetch(
						"https://jobs.internal/clip-capabilities",
						{ signal: AbortSignal.timeout(3000) },
					);
					return (
						res.ok &&
						((await res.json()) as { configured: boolean }).configured === true
					);
				} catch {
					return false;
				}
			},
			async dispatch(id) {
				const res = await env.GENERATION_JOBS.fetch(
					`https://jobs.internal/clips/${id}`,
					{ method: "POST", signal: AbortSignal.timeout(5000) },
				);
				if (!res.ok) throw new Error("Clip dispatch unavailable");
			},
		},
	);
}
