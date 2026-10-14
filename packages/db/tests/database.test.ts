import assert from "node:assert/strict";
import { test } from "node:test";
import { closeDb, createDb } from "@kousa/db";
import { sql } from "drizzle-orm";
import { localDatabaseConfig } from "../src/config";

test("local application database can write and read isolated data", async (t) => {
  const db = createDb(localDatabaseConfig);
  t.after(() => closeDb(db));
  await db.execute(sql`CREATE TEMP TABLE local_smoke (value integer)`);
  await db.execute(sql`INSERT INTO local_smoke VALUES (42)`);
  const rows = await db.execute(sql`SELECT value FROM local_smoke`);
  assert.ok("rows" in rows);
  assert.deepEqual(rows.rows, [{ value: 42 }]);
});

test("local database selection rejects remote hosts and unexpected database names", () => {
  for (const url of [
    "postgresql://example.neon.tech:5432/kousa",
    "postgresql://127.0.0.1:5432/production",
    "postgresql://127.0.0.1:5432/kousa?host=example.neon.tech",
  ]) {
    assert.throws(
      () => createDb({ DATABASE_MODE: "local", DATABASE_URL: url }),
      /Local database must/,
    );
  }
});

test("production selection preserves the Neon HTTP query transport", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({
      fields: [{ name: "value", dataTypeID: 23 }],
      rows: [[42]],
      rowCount: 1,
    });
  });
  const db = createDb({
    DATABASE_MODE: "neon-http",
    DATABASE_URL: "postgresql://test:test@example.neon.tech/test",
  });
  const result = await db.execute(sql`SELECT 42 AS value`);
  assert.deepEqual(result.rows, [{ value: 42 }]);
  assert.equal(requests, 1);
});
