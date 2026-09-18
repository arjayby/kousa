import { GenerationError } from "@kousa/generation/input";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import type { Context } from "../src/context";
import { createRunRouter } from "../src/routers/runs";

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

const history = vi.fn();
const detail = vi.fn();
const cancel = vi.fn();
const router = createRunRouter(() => ({ history, detail, cancel }));
const client = (id: string | null) =>
	createRouterClient(router, { context: contextFor(id) });
const request = {
	projectId: crypto.randomUUID(),
	id: crypto.randomUUID(),
	kind: "workflow" as const,
};
it("requires authentication to browse, inspect, or cancel runs", async () => {
	for (const action of [
		() => client(null).history(request),
		() => client(null).detail(request),
		() => client(null).cancel(request),
	]) {
		await expect(action()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	}
	expect(history).not.toHaveBeenCalled();
	expect(detail).not.toHaveBeenCalled();
	expect(cancel).not.toHaveBeenCalled();
});
it("derives the stop actor from the session and strips status and credit fields", async () => {
	cancel.mockResolvedValueOnce({});
	await client("editor").cancel({
		...request,
		userId: "owner",
		status: "cancelled",
		credits: 0,
	} as typeof request);
	expect(cancel).toHaveBeenLastCalledWith("editor", request);
});
it("validates run identity, kind, and bounded pagination before calling the service", async () => {
	const count = cancel.mock.calls.length;
	await expect(
		client("owner").cancel({ ...request, id: "bad" }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("owner").cancel({
			...request,
			kind: "other",
		} as unknown as typeof request),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("owner").history({ projectId: request.projectId, limit: 1000 }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("owner").history({
			projectId: request.projectId,
			cursor: { createdAt: "invalid", id: request.id },
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(cancel).toHaveBeenCalledTimes(count);
});
it("preserves permission, missing-run, and workflow-child cancellation errors", async () => {
	for (const code of ["FORBIDDEN", "NOT_FOUND", "CONFLICT"] as const) {
		cancel.mockRejectedValueOnce(new GenerationError(code, "Unavailable"));
		await expect(client("owner").cancel(request)).rejects.toMatchObject({
			code,
		});
	}
});
