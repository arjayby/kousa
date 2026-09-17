import { fileURLToPath, URL } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createCreditStore } from "./src/credit-store";
import { createGenerationStore } from "./src/generation-store";
import { createGraphStore } from "./src/graph-store";
import { createMediaStore } from "./src/media-store";
import { createProjectStore } from "./src/project-store";
import { user } from "./src/schema/auth";
import { creditGrant } from "./src/schema/credits";
import { generationRun } from "./src/schema/generations";
import { graphRun } from "./src/schema/graph-runs";
import { mediaAsset } from "./src/schema/media";
import { project, projectMember } from "./src/schema/projects";

export async function createGenerationTestDatabase() {
	const db = drizzle();
	await migrate(db, {
		migrationsFolder: fileURLToPath(
			new URL("./src/migrations", import.meta.url),
		),
	});
	return {
		store: createGenerationStore(db),
		graphs: createGraphStore(db),
		media: createMediaStore(db),
		credits: createCreditStore(db),
		projects: createProjectStore(db),
		async reset() {
			await db.delete(generationRun);
			await db.delete(graphRun);
			await db.delete(mediaAsset);
			await db.delete(project);
			await db.delete(creditGrant);
			await db.delete(user);
			await db.insert(user).values(
				["owner", "editor", "viewer", "outsider"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
				})),
			);
			const [created] = await db
				.insert(project)
				.values({ name: "Test", ownerId: "owner" })
				.returning();
			if (!created) throw new Error("Missing fixture");
			await db.insert(projectMember).values([
				{ projectId: created.id, userId: "editor", role: "editor" },
				{ projectId: created.id, userId: "viewer", role: "viewer" },
			]);
			return created.id;
		},
		grant(userId: string, credits = 1) {
			return db.insert(creditGrant).values({
				userId,
				credits,
				amount: 500,
				currency: "usd",
				polarOrderId: crypto.randomUUID(),
				polarCheckoutId: crypto.randomUUID(),
				polarCustomerId: "test",
				polarProductId: "test",
			});
		},
		setGraph(projectId: string, canvas: unknown) {
			return db
				.update(project)
				.set({ canvas })
				.where(eq(project.id, projectId));
		},
		revoke(userId: string) {
			return db.delete(projectMember).where(eq(projectMember.userId, userId));
		},
		expire(id: string) {
			return db
				.update(generationRun)
				.set({ expiresAt: new Date(0) })
				.where(eq(generationRun.id, id));
		},
		expireGraph(id: string) {
			return db
				.update(graphRun)
				.set({ expiresAt: new Date(0) })
				.where(eq(graphRun.id, id));
		},
		interrupt(id: string) {
			return db
				.update(generationRun)
				.set({ providerStartedAt: new Date(Date.now() - 180_000) })
				.where(eq(generationRun.id, id));
		},
		close: () => db.$client.close(),
	};
}
