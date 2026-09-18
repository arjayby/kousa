import { fileURLToPath, URL } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createMediaGalleryStore } from "./src/media-gallery-store";
import { createMediaLifecycleStore } from "./src/media-lifecycle-store";
import { createMediaStore } from "./src/media-store";
import { createProjectStore } from "./src/project-store";
import { user } from "./src/schema/auth";
import { mediaAsset } from "./src/schema/media";
import { project, projectMember } from "./src/schema/projects";

export async function createMediaTestDatabase() {
	const db = drizzle();
	await migrate(db, {
		migrationsFolder: fileURLToPath(
			new URL("./src/migrations", import.meta.url),
		),
	});
	return {
		gallery: createMediaGalleryStore(db),
		lifecycle: createMediaLifecycleStore(db),
		query: (text: string, params: unknown[] = []) =>
			db.$client.query(text, params),
		store: createMediaStore(db),
		projects: createProjectStore(db),
		async reset() {
			await db.delete(mediaAsset);
			await db.delete(project);
			await db.delete(user);
			await db.insert(user).values(
				["owner", "editor", "viewer", "outsider"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
				})),
			);
			const [created, other] = await db
				.insert(project)
				.values([
					{ name: "Media", ownerId: "owner" },
					{ name: "Other", ownerId: "outsider" },
				])
				.returning();
			if (!created || !other) throw new Error("Missing fixtures");
			await db.insert(projectMember).values([
				{ projectId: created.id, userId: "editor", role: "editor" },
				{ projectId: created.id, userId: "viewer", role: "viewer" },
			]);
			return { projectId: created.id, otherProjectId: other.id };
		},
		revoke: (id: string) =>
			db.delete(projectMember).where(eq(projectMember.userId, id)),
		rows: () => db.select().from(mediaAsset),
		close: () => db.$client.close(),
	};
}
