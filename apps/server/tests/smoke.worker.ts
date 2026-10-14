import app from "../src/index";
import { createClickHouse, type ClickHouseConfig } from "../src/clickhouse";

// This entry point is used only by the local integration suite.
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname !== "/__clickhouse-smoke") {
      return app.fetch(request, env, ctx);
    }
    if (env.DATABASE_MODE !== "local" || env.CLICKHOUSE_URL !== "http://127.0.0.1:8123") {
      return new Response("Local smoke check only", { status: 403 });
    }
    const client = createClickHouse(env);
    const table = `local_smoke_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const health = await client.ping();
      await client.command({ query: `CREATE TABLE ${table} (value UInt32) ENGINE = Memory` });
      await client.insert({ table, values: [{ value: 42 }], format: "JSONEachRow" });
      const result = await client.query({
        query: `SELECT value FROM ${table}`,
        format: "JSONEachRow",
      });
      return Response.json({ healthy: health.success, rows: await result.json() });
    } finally {
      try {
        await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      } finally {
        await client.close();
      }
    }
  },
} satisfies ExportedHandler<Env & ClickHouseConfig>;
