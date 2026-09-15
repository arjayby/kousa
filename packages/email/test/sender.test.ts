import { describe, expect, it, vi } from "vitest";
import { createEmailSender, EmailDeliveryError } from "../src/sender";
import { projectInvitationEmail } from "../src/templates";

const content = {
	to: "guest@example.test",
	subject: "Invitation",
	text: "Private invitation body",
};
const config = {
	from: "invites@mail.kousa.app",
	apiKey: "re_test_key",
};
const accepted = () => Response.json({ id: "resend-message" });

describe("Resend email delivery", () => {
	it.each([
		{ from: config.from },
		{ apiKey: config.apiKey },
		{ ...config, from: "not-an-email" },
		{ ...config, apiKey: "  " },
	])("fails closed with invalid configuration %j", async (options) => {
		const request = vi.fn<typeof fetch>();
		const email = createEmailSender({ ...options, fetch: request });
		expect(email.isConfigured()).toBe(false);
		await expect(email.send(content)).rejects.toMatchObject({
			code: "not_configured",
		});
		expect(request).not.toHaveBeenCalled();
	});
	it("submits the sender and recipient to Resend and records its message ID", async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(accepted());
		const email = createEmailSender({ ...config, fetch: request });
		expect(email.isConfigured()).toBe(true);
		expect(await email.send({ ...content, html: "<p>Invitation</p>" })).toEqual(
			{
				messageId: "resend-message",
			},
		);
		const [url, init] = request.mock.calls[0] ?? [];
		expect(url).toBe("https://api.resend.com/emails");
		expect(init?.method).toBe("POST");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer re_test_key",
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(init?.body))).toEqual({
			...content,
			to: [content.to],
			from: config.from,
			html: "<p>Invitation</p>",
		});
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});
	it("deduplicates the same message while allowing a new invitation link or recipient", async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => accepted());
		const email = createEmailSender({ ...config, fetch: request });
		const invitation = {
			...content,
			text: "https://kousa.app/invite#private-token",
		};
		await email.send(invitation);
		await email.send(invitation);
		await email.send({
			...invitation,
			text: "https://kousa.app/invite#new-token",
		});
		await email.send({ ...invitation, to: "other@example.test" });
		const keys = request.mock.calls.map(([, init]) =>
			new Headers(init?.headers).get("Idempotency-Key"),
		);
		expect(keys[0]).toMatch(/^kousa\/[a-f0-9]{64}$/);
		expect(keys[1]).toBe(keys[0]);
		expect(new Set([keys[0], keys[2], keys[3]]).size).toBe(3);
	});
	it.each(["{}", '{"id":""}', "invalid-json"])(
		"does not claim success without a valid message ID: %s",
		async (body) => {
			const request = vi
				.fn<typeof fetch>()
				.mockResolvedValue(new Response(body));
			await expect(
				createEmailSender({ ...config, fetch: request }).send(content),
			).rejects.toMatchObject({ code: "unconfirmed" });
		},
	);
	it.each([401, 403, 409, 422, 429, 500])(
		"handles HTTP %s without exposing the provider body",
		async (status) => {
			const request = vi
				.fn<typeof fetch>()
				.mockResolvedValue(new Response("private provider data", { status }));
			const promise = createEmailSender({ ...config, fetch: request }).send(
				content,
			);
			await expect(promise).rejects.toBeInstanceOf(EmailDeliveryError);
			await expect(promise).rejects.toMatchObject({
				code: status >= 500 || status === 409 ? "unconfirmed" : "rejected",
			});
			await expect(promise).rejects.not.toThrow("private provider data");
			expect(request).toHaveBeenCalledTimes(1);
		},
	);
	it("does not retry ambiguous network failures or leak their error text", async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error("private invitation token"));
		const promise = createEmailSender({ ...config, fetch: request }).send(
			content,
		);
		await expect(promise).rejects.toMatchObject({ code: "unconfirmed" });
		await expect(promise).rejects.not.toThrow("private invitation token");
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("aborts a stalled request after 20 seconds and reports an uncertain result", async () => {
		vi.useFakeTimers();
		try {
			const started = Promise.withResolvers<void>();
			const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
				started.resolve();
				return new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("timeout")),
					);
				});
			});
			const assertion = expect(
				createEmailSender({ ...config, fetch: request }).send(content),
			).rejects.toMatchObject({ code: "unconfirmed" });
			await started.promise;
			await vi.advanceTimersByTimeAsync(20_000);
			await assertion;
			expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
			expect(request).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	it("escapes project content and uses the recipient-specific fragment link", () => {
		const token = "a".repeat(64);
		const url = `https://kousa.app/invite#${token}`;
		const email = projectInvitationEmail({
			to: content.to,
			projectName: '<script>alert("x")</script>',
			role: "editor",
			expiresAt: new Date("2026-10-01T00:00:00Z"),
			url,
		});
		expect(email.to).toBe(content.to);
		expect(email.html).not.toContain("<script>");
		expect(email.html).toContain("&lt;script&gt;");
		expect(email.text).toContain("as an editor");
		expect(email.text).toContain(url);
		expect(new URL(url).search).toBe("");
	});
});
