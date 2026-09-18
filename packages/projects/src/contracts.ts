import { z } from "zod";
import { canvasDocumentSchema } from "./canvas";

export const projectName = z
	.string()
	.trim()
	.min(1, "Enter a project name.")
	.max(120, "Use 120 characters or fewer.");
export const projectIdInput = z.object({ projectId: z.uuid() });
export const canvasIdInput = projectIdInput.extend({
	canvasId: z.uuid().optional(),
});
export const canvasName = z
	.string()
	.trim()
	.min(1, "Enter a canvas name.")
	.max(120, "Use 120 characters or fewer.");
export const createCanvasInput = projectIdInput.extend({ name: canvasName });
export const renameCanvasInput = projectIdInput.extend({
	canvasId: z.uuid(),
	name: canvasName,
});
export const saveCanvasInput = canvasIdInput.extend({
	expectedRevision: z.number().int().min(0).max(2_147_483_646),
	document: canvasDocumentSchema,
});
export const createProjectInput = z.object({ name: projectName });
export const renameProjectInput = projectIdInput.extend({ name: projectName });
export const listProjectsInput = z
	.object({ offset: z.number().int().min(0).max(1_000_000).default(0) })
	.default({ offset: 0 });
export const memberRole = z.enum(["editor", "viewer"]);
export const memberInput = projectIdInput.extend({
	userId: z.string().min(1).max(128),
});
export const changeMemberInput = memberInput.extend({ role: memberRole });
export const invitationEmail = z
	.string()
	.trim()
	.toLowerCase()
	.pipe(z.email("Enter a valid email address.").max(254));
export const invitationExpiry = z.union([
	z.literal(1),
	z.literal(7),
	z.literal(30),
]);
export const createInviteInput = projectIdInput.extend({
	email: invitationEmail,
	role: memberRole,
	expiresInDays: invitationExpiry.default(7),
});
export const projectAccessInput = projectIdInput.extend({
	offset: z.number().int().min(0).max(1_000_000).default(0),
});
export const revokeInviteInput = projectIdInput.extend({ inviteId: z.uuid() });
export const resendInviteInput = revokeInviteInput;
export const inviteTokenInput = z.object({
	token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid invitation."),
});
export type ProjectRole = "owner" | z.infer<typeof memberRole>;

export function permissionsFor(role: ProjectRole) {
	return {
		canEdit: role === "owner" || role === "editor",
		canManageAccess: role === "owner",
	};
}
