import { fileURLToPath, URL } from "node:url";
import { eq } from "drizzle-orm";
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
		addUsers: (users: Array<{ id: string; name: string; email: string }>) =>
			db.insert(user).values(users),
		addMember: (input: typeof projectMember.$inferInsert) =>
			db.insert(projectMember).values(input),
		expireInvite: (id: string) =>
			db
				.update(projectInvite)
				.set({ expiresAt: new Date(0) })
				.where(eq(projectInvite.id, id)),
		invitations: () => db.select().from(projectInvite),
		clear: () => db.delete(project),
		close: () => db.$client.close(),
	};
}
