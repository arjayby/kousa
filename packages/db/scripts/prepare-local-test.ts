import { execFileSync } from "node:child_process";
import pg from "pg";
import { localDatabaseConfig } from "../src/config";

const pool = new pg.Pool({ connectionString: localDatabaseConfig.DATABASE_URL });
try {
  const result = await pool.query("SELECT 1 FROM pg_database WHERE datname = 'kousa_test'");
  if (result.rowCount === 0) {
    await pool.query("CREATE DATABASE kousa_test");
  }
} finally {
  await pool.end();
}
execFileSync("pnpm", ["exec", "drizzle-kit", "migrate", "--config", "drizzle.local.config.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    LOCAL_DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  },
});
