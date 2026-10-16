import { randomUUID } from "node:crypto";
import { afterEach, test, type Cookie } from "@e2e-dev/web";
import type { AppRouterClient } from "@kousa/api/routers/index";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { closeDb, createDb } from "@kousa/db";
import { sql } from "drizzle-orm";
import { credentials, expect } from "e2e";
import { z } from "zod";

const emails: string[] = [];

declare global {
  interface Window {
    workspaceTestTab?: Window | null;
  }
}

async function apiUser(baseUrl: string, name: string) {
  const origin = new URL(baseUrl).origin;
  const email = `e2e-${randomUUID()}@example.test`;
  emails.push(email);
  const response = await fetch(new URL("/api/auth/sign-up/email", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, name, password: randomUUID() }),
  });
  if (!response.ok) throw new Error(`Unable to register local test User: HTTP ${response.status}`);
  const { user } = z
    .object({ user: z.object({ id: z.string(), email: z.email() }) })
    .parse(await response.json());
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "");
  const cookieHeader = cookies.join("; ");
  const browserCookies: Cookie[] = cookies.map((cookie) => ({
    url: baseUrl,
    name: cookie.slice(0, cookie.indexOf("=")),
    value: cookie.slice(cookie.indexOf("=") + 1),
  }));
  const client: AppRouterClient = createORPCClient(
    new RPCLink({
      url: new URL("/rpc", baseUrl).href,
      fetch: (request, options) => {
        const headers = new Headers(request.headers);
        headers.set("Cookie", cookieHeader);
        headers.set("Origin", origin);
        return fetch(request, { ...options, headers });
      },
    }),
  );
  return { user, client, browserCookies };
}

afterEach(async () => {
  const db = createDb({
    DATABASE_MODE: "local",
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  try {
    for (const email of emails.splice(0)) {
      await db.execute(
        sql`DELETE FROM workspace WHERE owner_user_id IN (SELECT id FROM "user" WHERE email = ${email})`,
      );
      await db.execute(sql`DELETE FROM "user" WHERE email = ${email}`);
      await fetch(
        `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        { method: "DELETE" },
      );
    }
  } finally {
    await closeDb(db);
  }
});

test("creates and switches Workspaces with independent URLs", async ({ app, screen, browser }) => {
  const email = `e2e-${randomUUID()}@example.test`;
  emails.push(email);
  await app.open("/login");
  await screen.getByLabel("Name").fill("Workspace Owner");
  await screen.getByLabel("Email").fill(email);
  await screen.getByLabel("Password").fill(credentials.user("disposable").password);
  await screen.getByRole("button", "Sign Up", { exact: true }).click();
  await expect(screen.getByRole("heading", "Workspaces", { exact: true })).toBeVisible();
  await screen.getByLabel("Workspace name", { exact: true }).fill("Acme");
  await screen.getByRole("button", "Create workspace", { exact: true }).click();
  await expect(screen.getByRole("heading", "Acme", { exact: true })).toBeVisible();
  const firstUrl = await browser.url();
  await expect(browser).toHaveURL(/\/workspaces\/[a-f0-9-]+$/);
  await screen.getByRole("link", "All workspaces", { exact: true }).click();
  await screen.getByLabel("Workspace name", { exact: true }).fill("Client");
  await screen.getByRole("button", "Create workspace", { exact: true }).click();
  await expect(screen.getByRole("heading", "Client", { exact: true })).toBeVisible();
  const secondUrl = await browser.url();
  await expect(secondUrl).not.toBe(firstUrl);
  await browser.evaluate((url) => {
    window.workspaceTestTab = window.open(url);
    return null;
  }, secondUrl);
  await expect
    .poll(() =>
      browser.evaluate(
        () => window.workspaceTestTab?.document.querySelector("main h1")?.textContent ?? "",
      ),
    )
    .toBe("Client");
  await screen.getByLabel("Switch workspace").selectOption({ label: "Acme" });
  await expect(browser).toHaveURL(firstUrl);
  await expect(screen.getByRole("heading", "Acme", { exact: true })).toBeVisible();
  await expect
    .poll(() => browser.evaluate(() => window.workspaceTestTab?.location.href ?? ""))
    .toBe(secondUrl);
  await browser.evaluate(() => {
    window.workspaceTestTab?.close();
    return null;
  });
});

test("an Owner shares an Invitation and its recipient signs up, verifies email, and joins as Viewer", async ({
  app,
  screen,
}) => {
  const ownerEmail = `e2e-owner-${randomUUID()}@example.test`;
  const memberEmail = `e2e-member-${randomUUID()}@example.test`;
  emails.push(ownerEmail, memberEmail);
  await app.open("/login");
  await screen.getByLabel("Name").fill("Invitation Owner");
  await screen.getByLabel("Email").fill(ownerEmail);
  await screen.getByLabel("Password").fill(credentials.user("disposable").password);
  await screen.getByRole("button", "Sign Up", { exact: true }).click();
  await screen.getByLabel("Workspace name", { exact: true }).fill("Invited Team");
  await screen.getByRole("button", "Create workspace", { exact: true }).click();
  await expect(screen.getByRole("heading", "Members", { exact: true })).toBeVisible();
  await screen.getByLabel("Invite email").fill(memberEmail);
  await screen.getByRole("button", "Create invitation", { exact: true }).click();
  await expect(screen.getByLabel("Invitation link")).toBeVisible();
  const invitationUrl = await screen.getByLabel("Invitation link").inputValue();
  await screen.getByRole("button", "Invitation Owner", { exact: true }).click();
  await screen.getByRole("menuitem", "Sign Out", { exact: true }).click();
  await app.open(invitationUrl);
  await expect(screen.getByRole("heading", "Create Account", { exact: true })).toBeVisible();
  await screen.getByLabel("Name").fill("Invited Viewer");
  await screen.getByLabel("Email").fill(memberEmail);
  await screen.getByLabel("Password").fill(credentials.user("disposable").password);
  await screen.getByRole("button", "Sign Up", { exact: true }).click();
  await expect(screen.getByRole("heading", "Join workspace", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Accept invitation", { exact: true })).toBeDisabled();
  await screen.getByRole("button", "Send verification email", { exact: true }).click();
  await expect(screen.getByRole("status")).toContainText("Verification email sent");
  const messages = z
    .object({ messages: z.array(z.object({ ID: z.string() })) })
    .parse(
      await (
        await fetch(
          `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${memberEmail}`)}`,
        )
      ).json(),
    );
  const messageId = messages.messages[0]?.ID;
  if (!messageId) throw new Error("No verification email captured");
  const message = z
    .object({ Text: z.string() })
    .parse(await (await fetch(`http://127.0.0.1:8025/api/v1/message/${messageId}`)).json());
  const link = message.Text.match(/http:\/\/127\.0\.0\.1:\d+\/api\/auth\/verify-email\?\S+/)?.[0];
  if (!link) throw new Error("No verification link captured");
  const url = new URL(link);
  await app.open(`${url.pathname}${url.search}`);
  await screen.getByRole("button", "Accept invitation", { exact: true }).click();
  await expect(screen.getByRole("heading", "Invited Team", { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Members", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Leave workspace", { exact: true })).toBeVisible();
});

test("the Owner renames the Workspace, changes a Role, and transfers ownership through the UI", async ({
  app,
  screen,
  browser,
}) => {
  if (!app.baseUrl) throw new Error("Local app URL unavailable");
  const owner = await apiUser(app.baseUrl, "Original Owner");
  const member = await apiUser(app.baseUrl, "Future Owner");
  const workspace = await owner.client.workspaces.create({ name: "Original Team" });
  const db = createDb({
    DATABASE_MODE: "local",
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  try {
    await db.execute(
      sql`INSERT INTO membership (workspace_id, user_id, role) VALUES (${workspace.id}, ${member.user.id}, 'viewer')`,
    );
  } finally {
    await closeDb(db);
  }
  await browser.setCookies(owner.browserCookies);
  await app.open(`/workspaces/${workspace.id}`);
  await screen.getByLabel("New workspace name").fill("Renamed Team");
  await screen.getByRole("button", "Save workspace name", { exact: true }).click();
  await expect(screen.getByRole("heading", "Renamed Team", { exact: true })).toBeVisible();
  await screen
    .getByRole("group", `Role for ${member.user.email}`, { exact: true })
    .getByRole("button", "Admin", { exact: true })
    .click();
  await expect
    .poll(async () => (await member.client.workspaces.get({ workspaceId: workspace.id })).role)
    .toBe("admin");
  await screen
    .getByRole("button", `Transfer ownership to ${member.user.email}`, { exact: true })
    .click();
  await expect(screen.getByRole("heading", "Members", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Leave workspace", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await owner.client.workspaces.get({ workspaceId: workspace.id })).role)
    .toBe("admin");
  await browser.setCookies(member.browserCookies);
  await app.open(`/workspaces/${workspace.id}`);
  await expect(screen.getByRole("heading", "Members", { exact: true })).toBeVisible();
  await screen.getByRole("button", `Remove ${owner.user.email}`, { exact: true }).click();
  await expect
    .poll(async () => {
      try {
        await owner.client.workspaces.get({ workspaceId: workspace.id });
        return "allowed";
      } catch (error) {
        if (error instanceof ORPCError) return error.code;
        throw error;
      }
    })
    .toBe("NOT_FOUND");
  await expect(screen.getByText(owner.user.email, { exact: true })).toHaveCount(0);
  await app.screenshot("workspace-owner-controls");
});

test("revocation clears the open Workspace and leaving another Workspace preserves other Memberships", async ({
  app,
  screen,
  browser,
}) => {
  if (!app.baseUrl) throw new Error("Local app URL unavailable");
  const owner = await apiUser(app.baseUrl, "Owner");
  const member = await apiUser(app.baseUrl, "Member");
  const revoked = await owner.client.workspaces.create({ name: "Revoked Team" });
  const leaving = await owner.client.workspaces.create({ name: "Leaving Team" });
  await member.client.workspaces.create({ name: "Personal Team" });
  const db = createDb({
    DATABASE_MODE: "local",
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  try {
    await db.execute(
      sql`INSERT INTO membership (workspace_id, user_id, role) VALUES (${revoked.id}, ${member.user.id}, 'admin'), (${leaving.id}, ${member.user.id}, 'viewer')`,
    );
  } finally {
    await closeDb(db);
  }
  await browser.setCookies(member.browserCookies);
  await app.open(`/workspaces/${revoked.id}`);
  await expect(screen.getByRole("heading", "Revoked Team", { exact: true })).toBeVisible();
  await owner.client.workspaces.removeMember({
    workspaceId: revoked.id,
    targetUserId: member.user.id,
  });
  await screen.getByRole("button", "Refresh workspace", { exact: true }).click({ timeout: 2000 });
  await expect(screen.getByRole("alert")).toContainText("Workspace unavailable");
  await expect(screen.getByRole("heading", "Revoked Team", { exact: true })).toHaveCount(0);
  await screen.getByRole("link", "All workspaces", { exact: true }).click();
  await expect(screen.getByRole("link", "Personal Team owner", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Revoked Team admin", { exact: true })).toHaveCount(0);
  await screen.getByRole("link", "Leaving Team viewer", { exact: true }).click();
  await screen.getByRole("button", "Leave workspace", { exact: true }).click();
  await expect(screen.getByRole("heading", "Workspaces", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Leaving Team viewer", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("link", "Personal Team owner", { exact: true })).toBeVisible();
});

test("a refreshed Membership list clears a revoked Workspace before browser history can show it again", async ({
  app,
  screen,
  browser,
}) => {
  if (!app.baseUrl) throw new Error("Local app URL unavailable");
  const owner = await apiUser(app.baseUrl, "Owner");
  const member = await apiUser(app.baseUrl, "Member");
  const revoked = await owner.client.workspaces.create({ name: "Former Team" });
  await member.client.workspaces.create({ name: "Current Team" });
  const db = createDb({
    DATABASE_MODE: "local",
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  try {
    await db.execute(
      sql`INSERT INTO membership (workspace_id, user_id, role) VALUES (${revoked.id}, ${member.user.id}, 'viewer')`,
    );
  } finally {
    await closeDb(db);
  }
  await browser.setCookies(member.browserCookies);
  await app.open(`/workspaces/${revoked.id}`);
  await expect(screen.getByRole("heading", "Former Team", { exact: true })).toBeVisible();
  await screen.getByLabel("Switch workspace").selectOption({ label: "Current Team" });
  await expect(screen.getByRole("heading", "Current Team", { exact: true })).toBeVisible();
  await owner.client.workspaces.removeMember({
    workspaceId: revoked.id,
    targetUserId: member.user.id,
  });
  await screen.getByRole("button", "Refresh workspace", { exact: true }).click();
  await expect(screen.getByRole("option", "Former Team", { exact: true })).toHaveCount(0);

  let releaseRequest = () => {};
  const blocked = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await browser.route("**/rpc/workspaces/get*", async (route) => {
    await blocked;
    await route.abort();
  });
  try {
    await app.back();
    await expect
      .poll(
        async () =>
          (await screen.getByText("Loading workspace...", { exact: true }).count()) > 0 ||
          (await screen.getByText("Workspace unavailable", { exact: true }).count()) > 0,
      )
      .toBe(true);
    await expect(screen.getByRole("heading", "Former Team", { exact: true })).toHaveCount(0);
  } finally {
    releaseRequest();
    await expect(screen.getByRole("alert")).toContainText("Workspace unavailable");
    await browser.unroute("**/rpc/workspaces/get*");
  }
});

test("ownership loss clears cached team data before ownership is later restored", async ({
  app,
  screen,
  browser,
}) => {
  if (!app.baseUrl) throw new Error("Local app URL unavailable");
  const owner = await apiUser(app.baseUrl, "First Owner");
  const successor = await apiUser(app.baseUrl, "Next Owner");
  const departed = await apiUser(app.baseUrl, "Departing Member");
  const workspace = await owner.client.workspaces.create({ name: "Changing Team" });
  const db = createDb({
    DATABASE_MODE: "local",
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  try {
    await db.execute(
      sql`INSERT INTO membership (workspace_id, user_id, role) VALUES (${workspace.id}, ${successor.user.id}, 'admin'), (${workspace.id}, ${departed.user.id}, 'viewer')`,
    );
  } finally {
    await closeDb(db);
  }
  await browser.setCookies(owner.browserCookies);
  await app.open(`/workspaces/${workspace.id}`);
  await expect(screen.getByText(departed.user.email, { exact: true })).toBeVisible();
  let releaseRequest = () => {};
  const blocked = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let blockedRequests = 0;
  const teamPattern = /\/rpc\/workspaces\/(members|invitations)(?:\?|$)/;
  await browser.route(teamPattern, async (route) => {
    blockedRequests += 1;
    await blocked;
    await route.abort();
  });
  try {
    await owner.client.workspaces.transferOwnership({
      workspaceId: workspace.id,
      targetUserId: successor.user.id,
    });
    await screen.getByRole("button", "Refresh workspace", { exact: true }).click();
    await expect.poll(() => blockedRequests).toBeGreaterThan(0);
    await expect(screen.getByRole("heading", "Members", { exact: true })).toHaveCount(0);
    await expect(screen.getByRole("button", "Leave workspace", { exact: true })).toBeVisible();
    await successor.client.workspaces.removeMember({
      workspaceId: workspace.id,
      targetUserId: departed.user.id,
    });
    await successor.client.workspaces.transferOwnership({
      workspaceId: workspace.id,
      targetUserId: owner.user.id,
    });
    await screen.getByRole("button", "Refresh workspace", { exact: true }).click();
    await expect(screen.getByRole("heading", "Members", { exact: true })).toBeVisible();
    await expect(screen.getByText(departed.user.email, { exact: true })).toHaveCount(0);
  } finally {
    releaseRequest();
    await expect.poll(() => screen.getByRole("alert").count()).toBeGreaterThan(0);
    await browser.unroute(teamPattern);
  }
});

test("a forged cross-origin request cannot mutate Workspaces using an existing login cookie", async ({
  app,
}) => {
  if (!app.baseUrl) throw new Error("Local app URL unavailable");
  const owner = await apiUser(app.baseUrl, "Owner");
  const forged: AppRouterClient = createORPCClient(
    new RPCLink({
      url: new URL("/rpc", app.baseUrl).href,
      fetch: (request, options) => {
        const headers = new Headers(request.headers);
        headers.set("Origin", "https://untrusted.example");
        headers.set(
          "Cookie",
          owner.browserCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        );
        return fetch(request, { ...options, headers });
      },
    }),
  );
  let result = "accepted";
  try {
    await forged.workspaces.create({ name: "Forged Workspace" });
  } catch (error) {
    if (error instanceof ORPCError) result = error.code;
    else throw error;
  }
  await expect(result).toBe("FORBIDDEN");
  await expect(await owner.client.workspaces.list()).toEqual([]);
});

test("a GET request cannot invoke a Workspace mutation", async ({ app }) => {
  if (!app.baseUrl) throw new Error("Local app URL unavailable");
  const owner = await apiUser(app.baseUrl, "Owner");
  const unsafeGet: AppRouterClient = createORPCClient(
    new RPCLink({
      method: "GET",
      url: new URL("/rpc", app.baseUrl).href,
      fetch: (request, options) => {
        const headers = new Headers(request.headers);
        headers.set(
          "Cookie",
          owner.browserCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        );
        return fetch(request, { ...options, headers });
      },
    }),
  );
  let result = "accepted";
  try {
    await unsafeGet.workspaces.create({ name: "Unsafe GET Workspace" });
  } catch (error) {
    if (error instanceof ORPCError) result = error.code;
    else throw error;
  }
  await expect(result).toBe("METHOD_NOT_SUPPORTED");
  await expect(await owner.client.workspaces.list()).toEqual([]);
});
