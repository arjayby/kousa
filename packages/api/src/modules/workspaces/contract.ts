import { z } from "zod";

export const workspaceIdSchema = z.uuid().brand<"WorkspaceId">();
export const userIdSchema = z.string().min(1).brand<"UserId">();
export const roleSchema = z.enum(["owner", "admin", "viewer"]);
export const memberRoleSchema = z.enum(["admin", "viewer"]);
export const workspaceNameSchema = z.string().trim().min(1).max(100);

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  name: workspaceNameSchema,
  role: roleSchema,
});

export const memberSchema = z.object({
  userId: userIdSchema,
  name: z.string(),
  email: z.email(),
  role: roleSchema,
});
export const successSchema = z.object({ success: z.literal(true) });

export const invitationIdSchema = z.uuid().brand<"InvitationId">();
export const invitationTokenSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"InvitationToken">();
export const invitationEmailSchema = z.email().trim().toLowerCase();
export const invitationSchema = z.object({
  id: invitationIdSchema,
  workspaceId: workspaceIdSchema,
  email: invitationEmailSchema,
  role: memberRoleSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.enum(["pending", "accepted", "revoked"]),
});
export const issuedInvitationSchema = invitationSchema.extend({ token: invitationTokenSchema });
export const websiteIdSchema = z.uuid().brand<"WebsiteId">();
export const websiteSchema = z.object({ id: websiteIdSchema, workspaceId: workspaceIdSchema });

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
