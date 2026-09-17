import type { GenerationStore } from "@kousa/db/generation-store";
import type { MediaService } from "@kousa/media/service";
import type { ProjectService } from "@kousa/projects/service";
import type { ImageProvider, TextProvider } from "../src/providers";
import {
	type Artifact,
	type ArtifactStore,
	createGenerationRunner,
} from "../src/runner";
import { createGenerationService } from "../src/service";
import { type DurableSteps, executeGenerationWorkflow } from "../src/workflow";

export function memoryArtifacts(): ArtifactStore {
	const values = new Map<string, Artifact>();
	return {
		get: async (id) => values.get(id) ?? null,
		put: async (id, value) => {
			values.set(id, value);
		},
		delete: async (id) => {
			values.delete(id);
		},
	};
}
export const inlineSteps: DurableSteps = {
	sleep: async () => {},
	do: async (_name, _options, callback) => callback(),
};
export const unavailableImage: ImageProvider = {
	configured: false,
	generate: async () => {
		throw new Error("Unexpected image call");
	},
};
export const unavailableMedia: Pick<MediaService, "stage"> = {
	stage: async () => {
		throw new Error("Unexpected media call");
	},
};

// Existing service/ledger tests execute the dispatcher inline. Production only
// submits a workflow; durable.test.ts separately verifies that queue boundary.
export function inlineService(
	store: GenerationStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	text: TextProvider,
	image = unavailableImage,
	media = unavailableMedia,
) {
	const runner = createGenerationRunner(
		store,
		memoryArtifacts(),
		text,
		image,
		media,
	);
	return createGenerationService(store, projects, {
		textConfigured: text.configured,
		imageConfigured: image.configured,
		dispatch: async (id) => {
			await executeGenerationWorkflow(id, runner, inlineSteps);
		},
	});
}
