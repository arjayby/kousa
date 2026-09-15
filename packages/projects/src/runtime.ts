import { createDb } from "@kousa/db";
import { createProjectStore } from "@kousa/db/project-store";
import { createProjectService } from "./service";

export function createProjects() {
	return createProjectService(createProjectStore(createDb()));
}
