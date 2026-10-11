import type { Session } from "@kousa/auth";
import type { Database } from "@kousa/db";

export type Context = {
  session: Session | null;
  db: Database;
};
