import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { createAuth, type Session } from "@kousa/auth";
import { closeDb, createDb } from "@kousa/db";
import { user } from "@kousa/db/schema/auth";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "@kousa/api/routers/index";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const localAuthConfig = {
  DATABASE_MODE: "local",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "local-development-only-secret-at-least-32-characters",
  CORS_ORIGIN: "http://localhost:3001",
  POLAR_ACCESS_TOKEN: "",
  POLAR_SUCCESS_URL: "http://localhost:3001",
} satisfies Parameters<typeof createAuth>[0];

export function workspaceFixture(t: TestContext) {
  const db = createDb({
    DATABASE_MODE: "local",
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  const auth = createAuth(localAuthConfig, db);
  const emails: string[] = [];
  const workspaceIds: string[] = [];
  t.after(async () => {
    try {
      for (const id of workspaceIds) {
        await db.execute(sql`DELETE FROM workspace WHERE id = ${id}`);
      }
      for (const email of emails) {
        await db.delete(user).where(eq(user.email, email));
      }
    } finally {
      await closeDb(db);
    }
  });

  async function signUp(name: string) {
    const email = `workspace-${randomUUID()}@example.test`;
    emails.push(email);
    const response = await auth.handler(
      new Request(`${localAuthConfig.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: localAuthConfig.CORS_ORIGIN },
        body: JSON.stringify({ email, name, password: "workspace-test-password-123" }),
      }),
    );
    assert.equal(response.status, 200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    assert.ok(session);
    const client = createRouterClient(appRouter, {
      context: {
        db,
        session,
        invitationAcceptanceEnabled: true,
        billingEnabled: false,
        reportFailure: () => undefined,
      },
    });
    return { client, session, email, cookie };
  }

  async function seedMember({
    workspaceId,
    userId,
    role,
  }: {
    workspaceId: string;
    userId: string;
    role: "admin" | "viewer";
  }) {
    await db.execute(
      sql`INSERT INTO membership (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, ${role})`,
    );
  }

  function independentClient(session: Session) {
    const independentDb = createDb({
      DATABASE_MODE: "local",
      DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
    });
    t.after(() => closeDb(independentDb));
    return createRouterClient(appRouter, {
      context: {
        db: independentDb,
        session,
        invitationAcceptanceEnabled: true,
        billingEnabled: false,
        reportFailure: () => undefined,
      },
    });
  }

  async function verifyEmail({ email, cookie }: { email: string; cookie: string }) {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "http://localhost:3001/dashboard" },
      headers: new Headers({ Cookie: cookie }),
    });
    const result = await fetch(
      `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const messages = z
      .object({ messages: z.array(z.object({ ID: z.string() })) })
      .parse(await result.json());
    const messageId = messages.messages[0]?.ID;
    assert.ok(messageId);
    t.after(() =>
      fetch("http://127.0.0.1:8025/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: [messageId] }),
      }),
    );
    const message = z
      .object({ Text: z.string() })
      .parse(await (await fetch(`http://127.0.0.1:8025/api/v1/message/${messageId}`)).json());
    const verificationUrl = message.Text.match(
      /http:\/\/localhost:3000\/api\/auth\/verify-email\?\S+/,
    )?.[0];
    assert.ok(verificationUrl);
    assert.equal(
      (await auth.handler(new Request(verificationUrl, { headers: { Cookie: cookie } }))).status,
      302,
    );
  }

  return { db, auth, signUp, workspaceIds, seedMember, independentClient, verifyEmail };
}
