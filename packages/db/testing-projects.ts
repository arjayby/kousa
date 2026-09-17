import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createProjectStore } from "./src/project-store";
import { user } from "./src/schema/auth";
import { project, projectInvite, projectMember } from "./src/schema/projects";

export async function createProjectTestDatabase() {
	const db = drizzle();
	await migrate(db, {
		migrationsFolder: fileURLToPath(
			new URL("./src/migrations", import.meta.url),
		),
	});
	return {
		store: createProjectStore(db),
		addUsers: (
			users: Array<{
				id: string;
				name: string;
				email: string;
				emailVerified?: boolean;
			}>,
		) => db.insert(user).values(users),
		addMember: (input: typeof projectMember.$inferInsert) =>
			db.insert(projectMember).values(input),
		expireInvite: (id: string) =>
			db
				.update(projectInvite)
				.set({ expiresAt: new Date(0) })
				.where(eq(projectInvite.id, id)),
		updateUser: (
			id: string,
			values: { email?: string; emailVerified?: boolean },
		) => db.update(user).set(values).where(eq(user.id, id)),
		ageInvite: (id: string) =>
			db
				.update(projectInvite)
				.set({ deliveryAttemptedAt: new Date(Date.now() - 180_000) })
				.where(eq(projectInvite.id, id)),
		invitations: () => db.select().from(projectInvite),
		clear: () => db.delete(project),
		close: () => db.$client.close(),
	};
}

export async function testLegacyInvitationMigration() {
	const db = drizzle();
	async function runMigration(name: string) {
		const source = await readFile(
			new URL(`./src/migrations/${name}`, import.meta.url),
			"utf8",
		);
		for (const statement of source.split("--> statement-breakpoint")) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
	}
	try {
		for (const name of [
			"0000_early_talkback.sql",
			"0001_loving_edwin_jarvis.sql",
			"0002_needy_liz_osborn.sql",
		])
			await runMigration(name);
		await db.insert(user).values([
			{ id: "owner", name: "Owner", email: "owner@example.test" },
			{ id: "member", name: "Member", email: "member@example.test" },
		]);
		// This fixture predates newer project columns in the current Drizzle schema.
		const result = await db.execute(
			sql`insert into project (name, owner_id) values ('Legacy project', 'owner') returning id`,
		);
		const created = result.rows[0];
		if (!created || typeof created.id !== "string")
			throw new Error("Test project missing");
		await db.execute(
			sql`insert into project_invite (project_id, token_hash, role, expires_at) values (${created.id}, 'legacy-pending', 'editor', now() + interval '7 days')`,
		);
		await db.execute(
			sql`insert into project_invite (project_id, token_hash, role, expires_at, accepted_at, accepted_by) values (${created.id}, 'legacy-accepted', 'viewer', now() + interval '7 days', now(), 'member')`,
		);
		await db
			.insert(projectMember)
			.values({ projectId: created.id, userId: "member", role: "viewer" });
		await runMigration("0003_wet_bromley.sql");
		await runMigration("0004_project_canvas.sql");
		await runMigration("0005_canvas_collaboration.sql");
		return {
			projects: await db.select().from(project),
			invites: await db.select().from(projectInvite),
			members: await db.select().from(projectMember),
		};
	} finally {
		await db.$client.close();
	}
}
