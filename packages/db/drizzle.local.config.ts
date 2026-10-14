import { defineConfig } from "drizzle-kit";
import { assertLocalDatabaseUrl, localDatabaseConfig } from "./src/config";

const url = process.env.LOCAL_DATABASE_URL ?? localDatabaseConfig.DATABASE_URL;
assertLocalDatabaseUrl(url);

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: { url },
});
