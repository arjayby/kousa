import { createDb } from "@kousa/db";
import { createProjectStore } from "@kousa/db/project-store";
import { createEmail } from "@kousa/email/runtime";
import { env } from "@kousa/env/server";
import { createProjectService } from "./service";

export function createProjects() {
	return createProjectService(createProjectStore(createDb()), {
		email: createEmail(),
		appUrl: env.BETTER_AUTH_URL,
	});
}
