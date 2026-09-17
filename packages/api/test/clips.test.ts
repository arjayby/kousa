import { ClipError } from "@kousa/media/clip-service";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import type { Context } from "../src/context";
import { createClipRouter } from "../src/routers/clips";

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

const start = vi.fn();
const preview = vi.fn();
const list = vi.fn();
const router = createClipRouter(() => ({ start, preview, list }));
const client = (id: string | null) =>
	createRouterClient(router, { context: contextFor(id) });
const request = {
	id: crypto.randomUUID(),
	projectId: crypto.randomUUID(),
	nodeId: crypto.randomUUID(),
	inputHash: "a".repeat(64),
};
it("requires authentication for clip preview, start and progress", async () => {
	for (const action of ["start", "preview", "list"] as const) {
		await expect(client(null)[action](request)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	}
	expect(start).not.toHaveBeenCalled();
	expect(preview).not.toHaveBeenCalled();
	expect(list).not.toHaveBeenCalled();
});
it("uses the signed-in actor and strips client-supplied plans", async () => {
	start.mockResolvedValueOnce({});
	await client("editor").start({
		...request,
		userId: "owner",
		plan: { videoAssetId: crypto.randomUUID() },
	} as typeof request);
	expect(start).toHaveBeenLastCalledWith("editor", request);
	preview.mockRejectedValueOnce(new ClipError("FORBIDDEN", "Only editors"));
	await expect(client("viewer").preview(request)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
});
it("rejects malformed clip IDs and hashes before dispatch", async () => {
	const count = start.mock.calls.length;
	for (const patch of [
		{ id: "invalid" },
		{ inputHash: "" },
		{ nodeId: "invalid" },
	]) {
		await expect(
			client("editor").start({ ...request, ...patch }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	expect(start).toHaveBeenCalledTimes(count);
});
