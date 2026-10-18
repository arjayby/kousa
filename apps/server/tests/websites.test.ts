import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "@kousa/api/routers/index";

import { workspaceFixture } from "./helpers/workspaces";

test("an Owner creates a Website, lists it, and reads it with distinct public and internal identifiers", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Website Owner");
  const workspace = await owner.client.workspaces.create({ name: "Website Team" });
  fixture.workspaceIds.push(workspace.id);
  assert.deepEqual(await owner.client.websites.list({ workspaceId: workspace.id }), []);
  const created = await owner.client.websites.create({
    workspaceId: workspace.id,
    name: "  Marketing  ",
    hostname: "example.com",
  });
  assert.equal(created.name, "Marketing");
  assert.equal(created.hostname, "example.com");
  assert.equal(created.workspaceId, workspace.id);
  assert.ok(created.publicTrackingId);
  assert.notEqual(created.publicTrackingId, created.id);
  assert.deepEqual(await owner.client.websites.list({ workspaceId: workspace.id }), [created]);
  assert.deepEqual(
    await owner.client.websites.get({ workspaceId: workspace.id, websiteId: created.id }),
    created,
  );
});

test("script delivery labels missing configuration and accepts HTTP only on loopback in local development", async (t) => {
  for (const config of [
    { url: null, allowLocalHttp: false, expected: "unconfigured" },
    { url: "http://localhost:3000/tracker.js", allowLocalHttp: true, expected: "configured" },
    { url: "http://127.0.0.1:4321/tracker.js", allowLocalHttp: true, expected: "configured" },
    { url: "http://cdn.example/tracker.js", allowLocalHttp: true, expected: "invalid" },
    { url: "http://localhost:3000/tracker.js", allowLocalHttp: false, expected: "invalid" },
    { url: "https://user:pass@cdn.example/tracker.js", allowLocalHttp: false, expected: "invalid" },
    { url: "javascript:alert(1)", allowLocalHttp: false, expected: "invalid" },
  ]) {
    await t.test(`${config.url ?? "unset"}, local=${config.allowLocalHttp}`, async (subtest) => {
      const fixture = workspaceFixture(subtest, config);
      const owner = await fixture.signUp("Owner");
      const workspace = await owner.client.workspaces.create({ name: "Configuration" });
      fixture.workspaceIds.push(workspace.id);
      const website = await owner.client.websites.create({
        workspaceId: workspace.id,
        name: "Site",
        hostname: "example.com",
      });
      const result = owner.client.websites.installation({
        workspaceId: workspace.id,
        websiteId: website.id,
      });
      if (config.expected === "invalid") {
        await assert.rejects(result, {
          code: "INTERNAL_SERVER_ERROR",
          message: "Website operation failed",
        });
      } else {
        const installation = await result;
        assert.equal(installation.kind, config.expected);
        if (installation.kind === "unconfigured")
          assert.equal(
            installation.snippet,
            `<script defer src="YOUR_SCRIPT_URL" data-tracking-id="${website.publicTrackingId}"></script>`,
          );
      }
    });
  }
});

test("installation returns the public tracking ID in an escaped future-SDK snippet, never internal IDs or readiness claims", async (t) => {
  const fixture = workspaceFixture(t, {
    url: "https://cdn.example/tracker.js?one=1&two=2",
    allowLocalHttp: false,
  });
  const owner = await fixture.signUp("Owner");
  const viewer = await fixture.signUp("Viewer");
  const workspace = await owner.client.workspaces.create({ name: "Installation" });
  fixture.workspaceIds.push(workspace.id);
  await fixture.seedMember({
    workspaceId: workspace.id,
    userId: viewer.session.user.id,
    role: "viewer",
  });
  const website = await owner.client.websites.create({
    workspaceId: workspace.id,
    name: "Site",
    hostname: "example.com",
  });
  const instructions = await viewer.client.websites.installation({
    workspaceId: workspace.id,
    websiteId: website.id,
  });
  assert.deepEqual(instructions, {
    kind: "configured",
    scriptUrl: "https://cdn.example/tracker.js?one=1&two=2",
    publicTrackingId: website.publicTrackingId,
    snippet: `<script defer src="https://cdn.example/tracker.js?one=1&amp;two=2" data-tracking-id="${website.publicTrackingId}"></script>`,
  });
  await owner.client.workspaces.removeMember({
    workspaceId: workspace.id,
    targetUserId: viewer.session.user.id,
  });
  await assert.rejects(
    viewer.client.websites.installation({ workspaceId: workspace.id, websiteId: website.id }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    owner.client.websites.installation({ workspaceId: crypto.randomUUID(), websiteId: website.id }),
    { code: "NOT_FOUND" },
  );
});

test("Website permissions use current Membership, isolate Workspaces, and never treat a public tracking ID as access", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const admin = await fixture.signUp("Admin");
  const viewer = await fixture.signUp("Viewer");
  const outsider = await fixture.signUp("Outsider");
  const workspace = await owner.client.workspaces.create({ name: "Team" });
  const other = await owner.client.workspaces.create({ name: "Other" });
  fixture.workspaceIds.push(workspace.id, other.id);
  await fixture.seedMember({
    workspaceId: workspace.id,
    userId: admin.session.user.id,
    role: "admin",
  });
  await fixture.seedMember({
    workspaceId: workspace.id,
    userId: viewer.session.user.id,
    role: "viewer",
  });
  const created = await admin.client.websites.create({
    workspaceId: workspace.id,
    name: "Admin site",
    hostname: "example.com",
  });
  const input = { workspaceId: workspace.id, websiteId: created.id };
  assert.deepEqual(await viewer.client.websites.get(input), created);
  assert.deepEqual(await viewer.client.websites.list({ workspaceId: workspace.id }), [created]);
  await assert.rejects(
    viewer.client.websites.create({
      workspaceId: workspace.id,
      name: "Denied",
      hostname: "denied.example",
    }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    viewer.client.websites.update({ ...input, name: "Denied", hostname: "denied.example" }),
    { code: "FORBIDDEN" },
  );
  for (const websiteId of [created.id, created.publicTrackingId, crypto.randomUUID()]) {
    await assert.rejects(outsider.client.websites.get({ ...input, websiteId }), {
      code: "NOT_FOUND",
      message: "Website not found",
    });
    await assert.rejects(owner.client.websites.get({ workspaceId: other.id, websiteId }), {
      code: "NOT_FOUND",
      message: "Website not found",
    });
    await assert.rejects(
      owner.client.websites.update({
        workspaceId: other.id,
        websiteId,
        name: "Denied",
        hostname: "denied.example",
      }),
      { code: "NOT_FOUND" },
    );
  }
  await assert.rejects(outsider.client.websites.list({ workspaceId: workspace.id }), {
    code: "NOT_FOUND",
  });
  await assert.rejects(
    outsider.client.websites.create({
      workspaceId: workspace.id,
      name: "Denied",
      hostname: "denied.example",
    }),
    { code: "NOT_FOUND" },
  );
  await owner.client.workspaces.setRole({
    workspaceId: workspace.id,
    targetUserId: admin.session.user.id,
    role: "viewer",
  });
  await assert.rejects(
    admin.client.websites.update({ ...input, name: "Denied", hostname: "denied.example" }),
    { code: "FORBIDDEN" },
  );
  await owner.client.workspaces.removeMember({
    workspaceId: workspace.id,
    targetUserId: admin.session.user.id,
  });
  await assert.rejects(admin.client.websites.get(input), { code: "NOT_FOUND" });
  await assert.rejects(
    admin.client.websites.update({ ...input, name: "Denied", hostname: "denied.example" }),
    { code: "NOT_FOUND" },
  );
  const anonymous = createRouterClient(appRouter, {
    context: {
      db: fixture.db,
      session: null,
      trackingScript: { url: null, allowLocalHttp: true },
      billingEnabled: false,
      invitationAcceptanceEnabled: false,
      reportFailure: () => undefined,
    },
  });
  await assert.rejects(anonymous.websites.get(input), { code: "UNAUTHORIZED" });
  await assert.rejects(anonymous.websites.list({ workspaceId: workspace.id }), {
    code: "UNAUTHORIZED",
  });
  await assert.rejects(
    anonymous.websites.create({
      workspaceId: workspace.id,
      name: "Denied",
      hostname: "denied.example",
    }),
    { code: "UNAUTHORIZED" },
  );
  await assert.rejects(
    anonymous.websites.update({ ...input, name: "Denied", hostname: "denied.example" }),
    { code: "UNAUTHORIZED" },
  );
  assert.deepEqual(await owner.client.websites.get(input), created);
});

test("editing name and hostname preserves identity and rejects duplicates without partially saving", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const workspace = await owner.client.workspaces.create({ name: "Edits" });
  fixture.workspaceIds.push(workspace.id);
  const first = await owner.client.websites.create({
    workspaceId: workspace.id,
    name: "Original",
    hostname: "example.com",
  });
  const other = await owner.client.websites.create({
    workspaceId: workspace.id,
    name: "Other",
    hostname: "www.example.com",
  });
  const edited = await owner.client.websites.update({
    workspaceId: workspace.id,
    websiteId: first.id,
    name: "Moved",
    hostname: "https://moved.example.com/path",
  });
  assert.deepEqual(edited, { ...first, name: "Moved", hostname: "moved.example.com" });
  await assert.rejects(
    owner.client.websites.update({
      workspaceId: workspace.id,
      websiteId: first.id,
      name: "Should not save",
      hostname: other.hostname,
    }),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    owner.client.websites.update({
      workspaceId: workspace.id,
      websiteId: first.id,
      name: "Should not save",
      hostname: "bad host",
    }),
    { code: "BAD_REQUEST" },
  );
  assert.deepEqual(
    await owner.client.websites.get({ workspaceId: workspace.id, websiteId: first.id }),
    edited,
  );
  const concurrent = await Promise.allSettled([
    owner.client.websites.update({
      workspaceId: workspace.id,
      websiteId: first.id,
      name: "First",
      hostname: "shared.example.com",
    }),
    fixture.independentClient(owner.session).websites.update({
      workspaceId: workspace.id,
      websiteId: other.id,
      name: "Second",
      hostname: "shared.example.com",
    }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    (await owner.client.websites.list({ workspaceId: workspace.id })).filter(
      (site) => site.hostname === "shared.example.com",
    ).length,
    1,
  );
});

test("duplicate hostnames conflict within a Workspace, including concurrent creates, but remain independent across Workspaces", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const first = await owner.client.workspaces.create({ name: "First" });
  const second = await owner.client.workspaces.create({ name: "Second" });
  fixture.workspaceIds.push(first.id, second.id);
  const input = { name: "Same name", hostname: "example.com" };
  const a = await owner.client.websites.create({ ...input, workspaceId: first.id });
  await assert.rejects(
    owner.client.websites.create({
      ...input,
      hostname: "https://EXAMPLE.com./page",
      workspaceId: first.id,
    }),
    { code: "CONFLICT", message: "This hostname already exists in this Workspace" },
  );
  const b = await owner.client.websites.create({ ...input, workspaceId: second.id });
  assert.notEqual(a.publicTrackingId, b.publicTrackingId);
  const independent = fixture.independentClient(owner.session);
  const concurrent = await Promise.allSettled([
    owner.client.websites.create({ ...input, hostname: "shop.example.com", workspaceId: first.id }),
    independent.websites.create({ ...input, hostname: "shop.example.com", workspaceId: first.id }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await owner.client.websites.list({ workspaceId: first.id })).length, 2);
});

test("Website inputs normalize URLs, internationalized names, and localhost while rejecting invalid hostnames", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const workspace = await owner.client.workspaces.create({ name: "Normalization" });
  fixture.workspaceIds.push(workspace.id);
  for (const [input, expected] of [
    ["  https://WWW.Example.com:8080/docs?x=1#top  ", "www.example.com"],
    ["EXAMPLE.com.", "example.com"],
    ["https://bücher.de", "xn--bcher-kva.de"],
    ["http://LOCALHOST:5173/path", "localhost"],
    ["app.example.com/path", "app.example.com"],
  ]) {
    assert.ok(input && expected);
    const result = await owner.client.websites.create({
      workspaceId: workspace.id,
      name: "Same name",
      hostname: input,
    });
    assert.equal(result.hostname, expected);
  }
  for (const hostname of [
    "",
    "bad host.example",
    "https://user:password@example.com",
    "ftp://example.com",
    "*.example.com",
    "127.0.0.1",
    "0x7f000001",
    "[::1]",
    "https://example.com\\@evil.com",
    "-bad.example",
    "a..example",
    "example.com..",
    "a".repeat(64) + ".example",
    "https://@example.com",
    "singlelabel",
  ]) {
    await assert.rejects(
      owner.client.websites.create({ workspaceId: workspace.id, name: "Invalid", hostname }),
      { code: "BAD_REQUEST" },
      hostname,
    );
  }
  await assert.rejects(
    owner.client.websites.create({
      workspaceId: workspace.id,
      name: "   ",
      hostname: "valid.example",
    }),
    { code: "BAD_REQUEST" },
  );
  assert.equal((await owner.client.websites.list({ workspaceId: workspace.id })).length, 5);
});
