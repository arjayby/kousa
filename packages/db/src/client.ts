import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
export function databaseClient(url: string) {
	return drizzle(neon(url), { schema });
}
