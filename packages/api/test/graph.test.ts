import { GenerationError } from "@kousa/generation/input";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import type { Context } from "../src/context";
import { createGraphRouter } from "../src/routers/graph";

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
const list = vi.fn();
const preview = vi.fn();
const router = createGraphRouter(() => ({ start, list, preview }));
const client = (id: string | null) =>
	createRouterClient(router, { context: contextFor(id) });
const request = {
	id: crypto.randomUUID(),
	projectId: crypto.randomUUID(),
	nodeId: crypto.randomUUID(),
	inputHash: "a".repeat(64),
};
it("requires authentication for workflow preview, start and progress", async () => {
	await expect(client(null).start(request)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	await expect(client(null).preview(request)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	await expect(client(null).list(request)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	expect(start).not.toHaveBeenCalled();
	expect(preview).not.toHaveBeenCalled();
	expect(list).not.toHaveBeenCalled();
});
it("derives workflow payer from session, strips client plans and preserves access/billing errors", async () => {
	start.mockRejectedValueOnce(
		new GenerationError("PAYMENT_REQUIRED", "Insufficient credits"),
	);
	await expect(
		client("editor").start({
			...request,
			userId: "owner",
			plan: [],
			credits: 0,
		} as typeof request),
	).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
	expect(start).toHaveBeenLastCalledWith("editor", request);
	preview.mockRejectedValueOnce(
		new GenerationError("FORBIDDEN", "Only editors"),
	);
	await expect(client("viewer").preview(request)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
});
it("validates hashes and IDs before reaching the workflow service", async () => {
	const count = start.mock.calls.length;
	await expect(
		client("owner").start({ ...request, id: "invalid" }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("owner").start({ ...request, inputHash: "" }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(start).toHaveBeenCalledTimes(count);
});
it("accepts multiple outputs with a session-derived payer and rejects ambiguous selections", async () => {
	const { nodeId, ...base } = request;
	const input = { ...base, nodeIds: [nodeId, crypto.randomUUID()] };
	start.mockResolvedValueOnce({});
	await client("editor").start(input);
	expect(start).toHaveBeenLastCalledWith("editor", input);
	const count = start.mock.calls.length;
	for (const invalid of [
		{ ...base },
		{ ...input, nodeId },
		{ ...base, nodeIds: [] },
		{ ...base, nodeIds: [nodeId, nodeId] },
		{ ...base, nodeIds: ["invalid"] },
		{ ...base, nodeIds: Array.from({ length: 21 }, () => crypto.randomUUID()) },
	]) {
		await expect(client("owner").start(invalid)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	}
	expect(start).toHaveBeenCalledTimes(count);
});
