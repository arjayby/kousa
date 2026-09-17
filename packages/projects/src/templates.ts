import type { TemplateStore } from "@kousa/db/template-store";
import type { ProjectService } from "./service";
import {
	renameTemplateInput,
	saveTemplateInput,
	templateIdInput,
	templateProjectInput,
} from "./template-contracts";
import { copyTemplateDocument } from "./template-document";

export class TemplateError extends Error {
	constructor(
		public readonly code:
			| "NOT_FOUND"
			| "FORBIDDEN"
			| "CONFLICT"
			| "BAD_REQUEST",
		message: string,
	) {
		super(message);
	}
}
async function requestHash(input: Record<string, string>) {
	const bytes = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(input)),
	);
	return Array.from(new Uint8Array(bytes), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
}
function outcome(result: string) {
	if (result === "CREATED" || result === "EXISTING") return;
	if (result === "NOT_FOUND")
		throw new TemplateError("NOT_FOUND", "Template not found.");
	if (result === "FORBIDDEN")
		throw new TemplateError(
			"FORBIDDEN",
			"Only owners and editors can save a project as a template.",
		);
	if (result === "LIMIT")
		throw new TemplateError(
			"CONFLICT",
			"Your library has 100 templates. Delete one before saving another.",
		);
	throw new TemplateError(
		"CONFLICT",
		"This request was already used for something else. Close the dialog and try again.",
	);
}
export function createTemplateService(
	store: TemplateStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
) {
	return {
		list: (actorId: string) => store.list(actorId),
		async save(actorId: string, raw: unknown) {
			const input = saveTemplateInput.parse(raw);
			const hash = await requestHash({
				projectId: input.projectId,
				name: input.name,
			});
			const existing = await store.get(actorId, input.id);
			if (existing) {
				if (existing.requestHash !== hash) outcome("CONFLICT");
				if (existing.deletedAt) outcome("NOT_FOUND");
				return { id: existing.id };
			}
			const access = await projects.get(actorId, {
				projectId: input.projectId,
			});
			if (!access.permissions.canEdit) outcome("FORBIDDEN");
			const saved = await projects.getCanvas(actorId, {
				projectId: input.projectId,
			});
			const document = copyTemplateDocument(saved.document);
			if (!document.nodes.length)
				throw new TemplateError(
					"BAD_REQUEST",
					"Add at least one node before saving a template.",
				);
			outcome(
				await store.save(actorId, { ...input, requestHash: hash, document }),
			);
			return { id: input.id };
		},
		async rename(actorId: string, raw: unknown) {
			const { templateId, name } = renameTemplateInput.parse(raw);
			const result = await store.rename(actorId, templateId, name);
			if (!result) throw new TemplateError("NOT_FOUND", "Template not found.");
			return result;
		},
		async remove(actorId: string, raw: unknown) {
			const { templateId } = templateIdInput.parse(raw);
			const result = await store.remove(actorId, templateId);
			if (!result) throw new TemplateError("NOT_FOUND", "Template not found.");
			return result;
		},
		async createProject(actorId: string, raw: unknown) {
			const input = templateProjectInput.parse(raw);
			const hash = await requestHash({
				templateId: input.templateId,
				name: input.name,
			});
			const existing = await store.projectRequest(actorId, input.id);
			if (existing) {
				if (existing.requestHash !== hash) outcome("CONFLICT");
				return { id: existing.id };
			}
			const template = await store.get(actorId, input.templateId);
			if (!template || template.deletedAt)
				throw new TemplateError("NOT_FOUND", "Template not found.");
			const document = copyTemplateDocument(template.document);
			outcome(
				await store.createProject(actorId, {
					...input,
					requestHash: hash,
					document,
				}),
			);
			return { id: input.id };
		},
	};
}
export type TemplateService = ReturnType<typeof createTemplateService>;
