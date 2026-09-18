import { createRouterClient } from "@orpc/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Context } from "../src/context";
import { createMediaRouter } from "../src/routers/media";

const list = vi.fn(async () => ({ assets: [], nextCursor: null }));
const router = createMediaRouter(() => ({ list }));
function client(id: string | null) {
	const date = new Date();
	const context: Context = {
		auth: null,
		session: id
			? {
					user: {
						id,
						name: id,
						email: `${id}@example.test`,
						emailVerified: true,
						image: null,
						createdAt: date,
						updatedAt: date,
					},
					session: {
						id: `session-${id}`,
						userId: id,
						token: `test-${id}`,
						expiresAt: new Date(Date.now() + 60_000),
						createdAt: date,
						updatedAt: date,
						ipAddress: null,
						userAgent: null,
					},
				}
			: null,
	};
	return createRouterClient(router, { context });
}

beforeEach(() => list.mockClear());

it("requires authentication before listing generated media", async () => {
	await expect(client(null).list({})).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	expect(list).not.toHaveBeenCalled();
});

it("uses the signed-in account and strips attempted account overrides", async () => {
	await expect(
		client("viewer").list({
			ownerId: "other",
			userId: "other",
			kind: "image",
		} as Parameters<ReturnType<typeof client>["list"]>[0]),
	).resolves.toEqual({ assets: [], nextCursor: null });
	expect(list).toHaveBeenCalledWith("viewer", {
		kind: "image",
		search: "",
		limit: 24,
	});
});

it("rejects invalid cursors, oversized pages and search strings", async () => {
	for (const input of [
		{ limit: 1000 },
		{ limit: 0 },
		{ search: "a".repeat(201) },
		{ cursor: { createdAt: "invalid", id: crypto.randomUUID() } },
		{ cursor: { createdAt: new Date().toISOString(), id: "invalid" } },
	]) {
		await expect(client("viewer").list(input)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	}
	expect(list).not.toHaveBeenCalled();
});
