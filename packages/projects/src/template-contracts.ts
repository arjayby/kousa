import { z } from "zod";
import { projectName } from "./contracts";

export const templateName = z
	.string()
	.trim()
	.min(1, "Enter a template name.")
	.max(120, "Use 120 characters or fewer.");
export const templateIdInput = z.object({ templateId: z.uuid() });
export const saveTemplateInput = z.object({
	id: z.uuid(),
	projectId: z.uuid(),
	canvasId: z.uuid().optional(),
	name: templateName,
});
export const renameTemplateInput = templateIdInput.extend({
	name: templateName,
});
export const templateProjectInput = templateIdInput.extend({
	id: z.uuid(),
	name: projectName,
});
