import { createDb } from "@kousa/db";
import { createTemplateStore } from "@kousa/db/template-store";
import { createProjects } from "./runtime";
import { createTemplateService } from "./templates";

export function createTemplates() {
	return createTemplateService(
		createTemplateStore(createDb()),
		createProjects(),
	);
}
