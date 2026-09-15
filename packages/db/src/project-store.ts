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

export function createProjectStore(db: ProjectDatabase) {
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
			role: MemberRole,
			tokenHash: string,
			expiresAt: Date,
		) {
			const result: unknown = await db.execute(sql`
				insert into ${projectInvite} (project_id, token_hash, role, expires_at)
				select ${project.id}, ${tokenHash}, ${role}::project_member_role, ${expiresAt.toISOString()}::timestamptz
				from ${project} where ${project.id} = ${projectId} and ${project.ownerId} = ${actorId}
				returning id, role, expires_at as "expiresAt"
			`);
			return (
				z
					.object({
						rows: z.array(
							z.object({
								id: z.string(),
								role: z.enum(["editor", "viewer"]),
								expiresAt: z.coerce.date(),
							}),
						),
					})
					.parse(result).rows[0] ?? null
			);
		},
		async invites(actorId: string, projectId: string) {
			return db
				.select({
					id: projectInvite.id,
					role: projectInvite.role,
					expiresAt: projectInvite.expiresAt,
					createdAt: projectInvite.createdAt,
				})
				.from(projectInvite)
				.where(
					and(
						eq(projectInvite.projectId, projectId),
						owns(actorId, projectId),
						isNull(projectInvite.acceptedAt),
						isNull(projectInvite.revokedAt),
						gt(projectInvite.expiresAt, sql`now()`),
					),
				)
				.orderBy(desc(projectInvite.createdAt))
				.limit(100);
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
		async previewInvite(tokenHash: string) {
			const [found] = await db
				.select({
					name: project.name,
					role: projectInvite.role,
					expiresAt: projectInvite.expiresAt,
				})
				.from(projectInvite)
				.innerJoin(project, eq(project.id, projectInvite.projectId))
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
