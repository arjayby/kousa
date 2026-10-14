import { neon } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { assertLocalDatabaseUrl, type DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  if (env.DATABASE_MODE === "local") {
    assertLocalDatabaseUrl(env.DATABASE_URL);
    const client = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    return pgDrizzle({ client, relations });
  }
  if (env.DATABASE_MODE === "neon-http") {
    return neonDrizzle({ client: neon(env.DATABASE_URL), relations });
  }
  throw new Error("DATABASE_MODE must be local or neon-http");
}

export type Database = ReturnType<typeof createDb>;

export async function closeDb(database: Database) {
  if (database.$client instanceof pg.Pool) {
    await database.$client.end();
  }
}
