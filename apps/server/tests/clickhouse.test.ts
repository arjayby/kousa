import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClickHouse } from "../src/clickhouse";

export const clickHouseConfig = {
  CLICKHOUSE_URL: "http://127.0.0.1:8123",
  CLICKHOUSE_DATABASE: "kousa",
  CLICKHOUSE_USERNAME: "kousa",
  CLICKHOUSE_PASSWORD: "kousa_local",
};

test("Workers-compatible ClickHouse client pings, writes, and reads isolated data", async () => {
  const client = createClickHouse(clickHouseConfig);
  const table = `local_smoke_${randomUUID().replaceAll("-", "")}`;
  try {
    assert.equal((await client.ping()).success, true);
    await client.command({ query: `CREATE TABLE ${table} (value UInt32) ENGINE = Memory` });
    await client.insert({ table, values: [{ value: 42 }], format: "JSONEachRow" });
    const result = await client.query({
      query: `SELECT value FROM ${table}`,
      format: "JSONEachRow",
    });
    assert.deepEqual(await result.json(), [{ value: 42 }]);
  } finally {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
  }
});
