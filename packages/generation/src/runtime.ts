import { createDb } from "@kousa/db";
import { createGenerationStore } from "@kousa/db/generation-store";
import { env } from "@kousa/env/server";
import { createMedia } from "@kousa/media/runtime";
import { createProjects } from "@kousa/projects/runtime";
import { createGatewayImageProvider, createGatewayProvider } from "./gateway";
import { createGenerationService } from "./service";

export function createGeneration() {
	return createGenerationService(
		createGenerationStore(createDb()),
		createProjects(),
		createGatewayProvider(env.AI_GATEWAY_API_KEY),
		{
			provider: createGatewayImageProvider(env.AI_GATEWAY_API_KEY),
			media: createMedia(),
		},
	);
}
