import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import { workspaceFixture } from "./helpers/workspaces";

test("local verification delivers to the development inbox and verifies the signed-in User", async (t) => {
  const fixture = workspaceFixture(t);
  const invitee = await fixture.signUp("Invited User");
  await fixture.auth.api.sendVerificationEmail({
    body: { email: invitee.email, callbackURL: "http://localhost:3001/dashboard" },
    headers: new Headers({ Cookie: invitee.cookie }),
  });
  const search = await fetch(
    `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${invitee.email}`)}`,
  );
  assert.equal(search.status, 200);
  const messages = z
    .object({ messages: z.array(z.object({ ID: z.string() })) })
    .parse(await search.json());
  assert.equal(messages.messages.length, 1);
  const messageId = messages.messages[0]?.ID;
  assert.ok(messageId);
  t.after(() =>
    fetch(`http://127.0.0.1:8025/api/v1/messages`, {
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
  const verified = await fixture.auth.handler(
    new Request(verificationUrl, { headers: { Cookie: invitee.cookie } }),
  );
  assert.equal(verified.status, 302);
  const session = await fixture.auth.api.getSession({
    headers: new Headers({ Cookie: invitee.cookie }),
  });
  assert.equal(session?.user.emailVerified, true);
});
