import { GenerationError } from "@kousa/generation/input";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import type { Context } from "../src/context";
import { createCanvasChatRouter } from "../src/routers/canvas-chat";

const compose = vi.fn();
const history = vi.fn();
const router = createCanvasChatRouter(() => ({ compose, history }));
function context(id: string | null): Context {
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
						token: "test",
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
const client = (id: string | null) =>
	createRouterClient(router, { context: context(id) });
const request = {
	id: crypto.randomUUID(),
	projectId: crypto.randomUUID(),
	canvasId: crypto.randomUUID(),
	message: "Compose an ad workflow",
	previousId: null,
};

it("requires authentication for proposals and private history", async () => {
	await expect(client(null).compose(request)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	await expect(client(null).history(request)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	expect(compose).not.toHaveBeenCalled();
	expect(history).not.toHaveBeenCalled();
});

it("uses the session actor and preserves safe permission errors", async () => {
	compose.mockRejectedValueOnce(
		new GenerationError("FORBIDDEN", "Editing access required."),
	);
	await expect(
		client("editor").compose({ ...request, userId: "owner" } as typeof request),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	expect(compose).toHaveBeenLastCalledWith("editor", request);
});

it("bounds requests before reaching the provider", async () => {
	const count = compose.mock.calls.length;
	await expect(
		client("editor").compose({ ...request, message: "x".repeat(2001) }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("editor").compose({ ...request, message: "   " }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("editor").compose({ ...request, previousId: "invalid" }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(compose).toHaveBeenCalledTimes(count);
});
