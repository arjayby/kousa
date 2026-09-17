import {
	and,
	desc,
	eq,
	exists,
	gt,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { user } from "./schema/auth";
import { project, projectInvite, projectMember } from "./schema/projects";

type ProjectDatabase = Pick<
	PgDatabase<PgQueryResultHKT>,
	"insert" | "select" | "update" | "delete" | "execute"
>;
type MemberRole = typeof projectMember.$inferSelect.role;
const inviteRow = z.object({
	id: z.string(),
	email: z.string(),
	role: z.enum(["editor", "viewer"]),
	expiresAt: z.coerce.date(),
	expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
});
const readInvite = (result: unknown) =>
	z.object({ rows: z.array(inviteRow) }).parse(result).rows[0] ?? null;
const inviteReturning = sql`id, email, role, expires_at as "expiresAt", expires_in_days as "expiresInDays"`;

export function createProjectStore(db: ProjectDatabase) {
	const eligibleRecipient = (
		projectId: string,
		email: string | typeof projectInvite.email,
	) => sql`not exists (
 select 1 from "user" u where lower(btrim(u.email)) = ${email} and (
 u.id = (select owner_id from project where id = ${projectId}) or
 exists (select 1 from project_member m where m.project_id = ${projectId} and m.user_id = u.id)
 ))`;
	const canResend = sql`(${projectInvite.deliveryStatus} = 'failed' or
 (${projectInvite.deliveryStatus} = 'sending' and ${projectInvite.deliveryAttemptedAt} < now() - interval '2 minutes') or
 (${projectInvite.deliveryStatus} = 'sent' and ${projectInvite.deliveryAttemptedAt} < now() - interval '1 minute'))`;
	const owns = (actorId: string, projectId: string) =>
		exists(
			db
				.select({ id: project.id })
				.from(project)
				.where(and(eq(project.id, projectId), eq(project.ownerId, actorId))),
		);
	const editable = (actorId: string) =>
		or(
			eq(project.ownerId, actorId),
			exists(
				db
					.select({ id: projectMember.userId })
					.from(projectMember)
					.where(
						and(
							eq(projectMember.projectId, project.id),
							eq(projectMember.userId, actorId),
							eq(projectMember.role, "editor"),
						),
					),
			),
		);
	const visible = (actorId: string) =>
		db
			.select({
				id: project.id,
				name: project.name,
				createdAt: project.createdAt,
				updatedAt: project.updatedAt,
				role: sql<
					"owner" | MemberRole
				>`case when ${project.ownerId} = ${actorId} then 'owner' else ${projectMember.role}::text end`,
			})
			.from(project)
			.leftJoin(
				projectMember,
				and(
					eq(projectMember.projectId, project.id),
					eq(projectMember.userId, actorId),
				),
			);
	const visibleTo = (actorId: string) =>
		or(eq(project.ownerId, actorId), isNotNull(projectMember.userId));

	return {
		async getCanvas(actorId: string, projectId: string) {
			const [found] = await db
				.select({
					document: project.canvas,
					revision: project.canvasRevision,
					updatedAt: project.canvasUpdatedAt,
				})
				.from(project)
				.leftJoin(
					projectMember,
					and(
						eq(projectMember.projectId, project.id),
						eq(projectMember.userId, actorId),
					),
				)
				.where(and(eq(project.id, projectId), visibleTo(actorId)))
				.limit(1);
			return found ?? null;
		},
		async saveCanvas(
			actorId: string,
			projectId: string,
			expectedRevision: number,
			document: unknown,
		) {
			// Permission and revision checks are part of the same atomic write.
			const [saved] = await db
				.update(project)
				.set({
					canvas: document,
					canvasRevision: sql`${project.canvasRevision} + 1`,
					canvasUpdatedAt: sql`now()`,
					updatedAt: sql`now()`,
				})
				.where(
					and(
						eq(project.id, projectId),
						editable(actorId),
						eq(project.canvasRevision, expectedRevision),
					),
				)
				.returning({
					revision: project.canvasRevision,
					updatedAt: project.canvasUpdatedAt,
				});
			return saved ?? null;
		},
		async create(actorId: string, name: string) {
			const [created] = await db
				.insert(project)
				.values({ ownerId: actorId, name })
				.returning({ id: project.id });
			if (!created) throw new Error("Project creation failed.");
			return created;
		},
		async list(actorId: string, offset: number) {
			const rows = await visible(actorId)
				.where(visibleTo(actorId))
				.orderBy(desc(project.updatedAt), desc(project.id))
				.offset(offset)
				.limit(21);
			return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
		},
		async get(actorId: string, projectId: string) {
			const [found] = await visible(actorId)
				.where(and(eq(project.id, projectId), visibleTo(actorId)))
				.limit(1);
			return found ?? null;
		},
		async rename(actorId: string, projectId: string, name: string) {
			// Authorization is part of the write, not a stale preflight lookup.
			const [updated] = await db
				.update(project)
				.set({ name, updatedAt: new Date() })
				.where(and(eq(project.id, projectId), editable(actorId)))
				.returning({ id: project.id });
			return updated ?? null;
		},
		async members(actorId: string, projectId: string) {
			return db
				.select({
					userId: projectMember.userId,
					name: user.name,
					email: user.email,
					role: projectMember.role,
				})
				.from(projectMember)
				.innerJoin(user, eq(user.id, projectMember.userId))
				.where(
					and(eq(projectMember.projectId, projectId), owns(actorId, projectId)),
				)
				.orderBy(projectMember.createdAt, projectMember.userId);
		},
		async changeMember(
			actorId: string,
			projectId: string,
			userId: string,
			role: MemberRole,
		) {
			const [updated] = await db
				.update(projectMember)
				.set({ role })
				.where(
					and(
						eq(projectMember.projectId, projectId),
						eq(projectMember.userId, userId),
						owns(actorId, projectId),
					),
				)
				.returning({ userId: projectMember.userId });
			return updated ?? null;
		},
		async removeMember(actorId: string, projectId: string, userId: string) {
			const [removed] = await db
				.delete(projectMember)
				.where(
					and(
						eq(projectMember.projectId, projectId),
						eq(projectMember.userId, userId),
						owns(actorId, projectId),
					),
				)
				.returning({ userId: projectMember.userId });
			return removed ?? null;
		},
		async createInvite(
			actorId: string,
			projectId: string,
			email: string,
			role: MemberRole,
			tokenHash: string,
			expiresInDays: 1 | 7 | 30,
		) {
			const result: unknown = await db.execute(sql`
 insert into ${projectInvite} (project_id, email, role, token_hash, expires_in_days, expires_at)
 select ${project.id}, ${email}, ${role}::project_member_role, ${tokenHash}, ${expiresInDays}, now() + ${expiresInDays} * interval '1 day'
 from ${project} where ${project.id} = ${projectId} and ${project.ownerId} = ${actorId} and ${eligibleRecipient(projectId, email)}
 on conflict (project_id, email) do update set
 role = excluded.role, token_hash = excluded.token_hash, expires_in_days = excluded.expires_in_days,
 expires_at = excluded.expires_at, accepted_at = null, accepted_by = null, revoked_at = null,
 delivery_status = 'sending', delivery_attempted_at = now(), sent_at = null, delivery_error = null, message_id = null
 where project_invite.accepted_at is not null or project_invite.revoked_at is not null or project_invite.expires_at <= now()
 returning ${inviteReturning}
 `);
			return readInvite(result);
		},
		async resendInvite(
			actorId: string,
			projectId: string,
			inviteId: string,
			tokenHash: string,
		) {
			const result: unknown = await db.execute(sql`
 update ${projectInvite} set token_hash = ${tokenHash},
 expires_at = now() + expires_in_days * interval '1 day',
 accepted_at = null, accepted_by = null, revoked_at = null, delivery_status = 'sending',
 delivery_attempted_at = now(), sent_at = null, delivery_error = null, message_id = null
 where id = ${inviteId} and project_id = ${projectId} and email is not null
 and ${owns(actorId, projectId)} and ${eligibleRecipient(projectId, projectInvite.email)} and ${canResend}
 returning ${inviteReturning}
 `);
			return readInvite(result);
		},
		async completeDelivery(
			inviteId: string,
			tokenHash: string,
			outcome: { messageId: string | null } | { error: string },
		) {
			// A late delivery response must never overwrite a newer resend's status.
			await db
				.update(projectInvite)
				.set(
					"error" in outcome
						? {
								deliveryStatus: "failed",
								deliveryError: outcome.error,
							}
						: {
								deliveryStatus: "sent",
								sentAt: new Date(),
								messageId: outcome.messageId,
								deliveryError: null,
							},
				)
				.where(
					and(
						eq(projectInvite.id, inviteId),
						eq(projectInvite.tokenHash, tokenHash),
					),
				);
		},
		async invites(actorId: string, projectId: string, offset: number) {
			const rows = await db
				.select({
					id: projectInvite.id,
					email: projectInvite.email,
					role: projectInvite.role,
					expiresAt: projectInvite.expiresAt,
					expiresInDays: projectInvite.expiresInDays,
					createdAt: projectInvite.createdAt,
					acceptedAt: projectInvite.acceptedAt,
					revokedAt: projectInvite.revokedAt,
					sentAt: projectInvite.sentAt,
					status: sql<"pending" | "accepted" | "revoked" | "expired">`case
 when ${projectInvite.acceptedAt} is not null then 'accepted'
 when ${projectInvite.revokedAt} is not null then 'revoked'
 when ${projectInvite.expiresAt} <= now() then 'expired' else 'pending' end`,
					deliveryStatus: sql<
						"sending" | "sent" | "failed"
					>`case when ${projectInvite.deliveryStatus} = 'sending'
 and ${projectInvite.deliveryAttemptedAt} < now() - interval '2 minutes' then 'failed' else ${projectInvite.deliveryStatus} end`,
					deliveryError: sql<
						string | null
					>`case when ${projectInvite.deliveryStatus} = 'sending'
 and ${projectInvite.deliveryAttemptedAt} < now() - interval '2 minutes' then 'unconfirmed' else ${projectInvite.deliveryError} end`,
					canResend: sql<boolean>`${projectInvite.email} is not null and ${eligibleRecipient(projectId, projectInvite.email)} and ${canResend}`,
				})
				.from(projectInvite)
				.where(
					and(eq(projectInvite.projectId, projectId), owns(actorId, projectId)),
				)
				.orderBy(
					desc(projectInvite.deliveryAttemptedAt),
					desc(projectInvite.id),
				)
				.offset(offset)
				.limit(21);
			return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
		},
		async revokeInvite(actorId: string, projectId: string, inviteId: string) {
			const [revoked] = await db
				.update(projectInvite)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(projectInvite.id, inviteId),
						eq(projectInvite.projectId, projectId),
						owns(actorId, projectId),
						isNull(projectInvite.acceptedAt),
						isNull(projectInvite.revokedAt),
					),
				)
				.returning({ id: projectInvite.id });
			return revoked ?? null;
		},
		async previewInvite(actorId: string, tokenHash: string) {
			const [found] = await db
				.select({
					name: project.name,
					email: projectInvite.email,
					requiresEmailVerification: sql<boolean>`not ${user.emailVerified}`,
					role: projectInvite.role,
					expiresAt: projectInvite.expiresAt,
				})
				.from(projectInvite)
				.innerJoin(project, eq(project.id, projectInvite.projectId))
				.innerJoin(
					user,
					and(
						eq(user.id, actorId),
						sql`lower(btrim(${user.email})) = ${projectInvite.email}`,
					),
				)
				.where(
					and(
						eq(projectInvite.tokenHash, tokenHash),
						isNull(projectInvite.acceptedAt),
						isNull(projectInvite.revokedAt),
						gt(projectInvite.expiresAt, sql`now()`),
					),
				)
				.limit(1);
			return found ?? null;
		},
		async acceptInvite(actorId: string, tokenHash: string) {
			// Claim and membership insertion are one atomic statement on Neon HTTP.
			// Concurrent claims lock the invite row; only one account can consume it.
			// Existing memberships keep their role, including a prior owner-assigned downgrade.
			const result: unknown = await db.execute(sql`
				with claimed as (
					update ${projectInvite} set accepted_at = now(), accepted_by = ${actorId}
					where token_hash = ${tokenHash} and accepted_at is null and revoked_at is null and expires_at > now()
					and exists (select 1 from ${project} where ${project.id} = ${projectInvite.projectId} and ${project.ownerId} <> ${actorId})
 and exists (select 1 from "user" u where u.id = ${actorId} and lower(btrim(u.email)) = ${projectInvite.email} and u.email_verified = true)
					returning project_id, role
				), membership as (
					insert into ${projectMember} (project_id, user_id, role)
					select project_id, ${actorId}, role from claimed
					on conflict (project_id, user_id) do nothing
					returning project_id
				)
				select project_id as "projectId" from claimed
			`);
			return (
				z
					.object({ rows: z.array(z.object({ projectId: z.string() })) })
					.parse(result).rows[0] ?? null
			);
		},
	};
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
