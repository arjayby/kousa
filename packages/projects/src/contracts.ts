import { z } from "zod";

export const projectName = z
	.string()
	.trim()
	.min(1, "Enter a project name.")
	.max(120, "Use 120 characters or fewer.");
export const projectIdInput = z.object({ projectId: z.uuid() });
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
export const createInviteInput = projectIdInput.extend({ role: memberRole });
export const revokeInviteInput = projectIdInput.extend({ inviteId: z.uuid() });
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
