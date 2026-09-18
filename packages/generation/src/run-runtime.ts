import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { createGraphStore } from "@kousa/db/graph-store";
import { createMediaStore } from "@kousa/db/media-store";
import { createProjects } from "@kousa/projects/runtime";
import { createRunService } from "./run-service";

export function createRuns() {
	const db = createDb();
	return createRunService(
		createGraphStore(db),
		createGenerationStore(db),
		createProjects(),
		createMediaStore(db),
	);
}
