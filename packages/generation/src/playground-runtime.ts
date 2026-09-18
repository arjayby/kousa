import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { createMedia } from "@kousa/media/runtime";
import { createProjects } from "@kousa/projects/runtime";
import { createPlaygroundService } from "./playground-service";
import { generationJobs } from "./runtime";

export function createPlayground() {
	return createPlaygroundService(
		createGenerationStore(createDb()),
		createProjects(),
		generationJobs(),
		createMedia(),
	);
}
