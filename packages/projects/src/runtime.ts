import { createDb } from "@kousa/db";
import { createProjectStore } from "@kousa/db/project-store";
import { createEmail } from "@kousa/email/runtime";
import { env } from "@kousa/env/server";
import { createCollaborationService } from "./collaboration";
import { createLiveblocksProvider } from "./collaboration-liveblocks";
import { createProjectService } from "./service";

export function createProjects() {
	const store = createProjectStore(createDb());
	return createProjectService(store, {
		email: createEmail(),
		appUrl: env.BETTER_AUTH_URL,
		collaboration: createCollaborationService(
			store,
			createLiveblocksProvider(env.LIVEBLOCKS_SECRET_KEY),
		),
	});
}

export function createCollaboration() {
	return createCollaborationService(
		createProjectStore(createDb()),
		createLiveblocksProvider(env.LIVEBLOCKS_SECRET_KEY),
	);
}
