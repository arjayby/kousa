import { createDb } from "@kousa/db";
import { createCanvasChatStore } from "@kousa/db/canvas-chat-store";
import { env } from "@kousa/env/server";
import { createProjects } from "@kousa/projects/runtime";
import { createCanvasChatService } from "./canvas-chat-service";
import { createGatewayProvider } from "./gateway";

export function createCanvasChat() {
	return createCanvasChatService(
		createCanvasChatStore(createDb()),
		createProjects(),
		createGatewayProvider(env.AI_GATEWAY_API_KEY),
	);
}
