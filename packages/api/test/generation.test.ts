import { GenerationError } from "@kousa/generation/input";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import type { Context } from "../src/context";
import { createGenerationRouter } from "../src/routers/generation";

function contextFor(id: string | null): Context {
	const date = new Date();
	return {
		auth: null,
		session: id
			? {
					user: {
						id,
						name: id,
						email: `${id}@example.test`,
						emailVerified: false,
						image: null,
						createdAt: date,
						updatedAt: date,
					},
					session: {
						id: `session-${id}`,
						userId: id,
						token: `test-only-${id}`,
						expiresAt: new Date(Date.now() + 60_000),
						createdAt: date,
						updatedAt: date,
						ipAddress: null,
						userAgent: null,
					},
				}
			: null,
	};
}

const generate = vi.fn();
const list = vi.fn();
const router = createGenerationRouter(() => ({ generate, list }));
const client = (id: string | null) =>
	createRouterClient(router, { context: contextFor(id) });
const request = {
	id: crypto.randomUUID(),
	projectId: crypto.randomUUID(),
	nodeId: crypto.randomUUID(),
	inputHash: "a".repeat(64),
};
it("requires a session before generation or result access", async () => {
	await expect(client(null).generate(request)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	await expect(
		client(null).list({ projectId: request.projectId }),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	expect(generate).not.toHaveBeenCalled();
	expect(list).not.toHaveBeenCalled();
});
it("derives the payer from the session and preserves safe billing errors", async () => {
	generate.mockRejectedValueOnce(
		new GenerationError("PAYMENT_REQUIRED", "You need 1 credit."),
	);
	await expect(
		client("editor").generate({
			...request,
			userId: "owner",
		} as typeof request),
	).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
	expect(generate).toHaveBeenLastCalledWith("editor", request);
});
it("rejects malformed run IDs before reaching the service", async () => {
	const count = generate.mock.calls.length;
	await expect(
		client("editor").generate({ ...request, id: "invalid" }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(generate).toHaveBeenCalledTimes(count);
});
