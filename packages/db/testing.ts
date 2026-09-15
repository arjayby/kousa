import { fileURLToPath, URL } from "node:url";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createCreditStore } from "./src/credit-store";
import { user } from "./src/schema/auth";
import { creditGrant } from "./src/schema/credits";

// Always in-memory. This test helper never reads DATABASE_URL or cloud credentials.
export async function createCreditTestDatabase() {
	const db = drizzle();
	const client = db.$client;
	await migrate(db, {
		migrationsFolder: fileURLToPath(
			new URL("./src/migrations", import.meta.url),
		),
	});
	return {
		store: createCreditStore(db),
		addUsers: (users: Array<{ id: string; name: string; email: string }>) =>
			db.insert(user).values(users),
		clearGrants: () => db.delete(creditGrant),
		close: () => client.close(),
	};
}
