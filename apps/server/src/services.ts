import { createAuth } from "@kousa/auth";
import { closeDb, createDb, type Database } from "@kousa/db";
import type { EvlogVariables } from "evlog/hono";

import { ENV } from "./env.server";

export type ServerEnvironment = EvlogVariables & {
  Variables: {
    db: Database;
    auth: ReturnType<typeof createAuth>;
  };
};

export async function createRequestServices() {
  const db = createDb(ENV);
  try {
    return { db, auth: createAuth(ENV, db) };
  } catch (error) {
    await closeDb(db);
    throw error;
  }
}
