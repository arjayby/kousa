import { env } from "@kousa/env/server";
import { databaseClient } from "./client";
export function createDb() {
	return databaseClient(env.DATABASE_URL);
}
