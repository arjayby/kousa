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
const history = vi.fn();
const historyAction = vi.fn();
const router = createGenerationRouter(() => ({
	generate,
	list,
	history,
	historyAction,
}));
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

it("protects history routes and validates pagination and actions", async () => {
	const input = {
		projectId: request.projectId,
		nodeId: request.nodeId,
		limit: 10,
	};
	await expect(client(null).history(input)).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	await expect(
		client(null).historyAction({
			...input,
			runId: request.id,
			action: "select",
		}),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await expect(
		client("viewer").history({ ...input, limit: 1000 }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		client("viewer").history({
			...input,
			cursor: { createdAt: "not-a-date", id: request.id },
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	history.mockResolvedValueOnce({ runs: [], nextCursor: null });
	await client("viewer").history(input);
	expect(history).toHaveBeenLastCalledWith("viewer", input);
	historyAction.mockRejectedValueOnce(
		new GenerationError("FORBIDDEN", "View only"),
	);
	await expect(
		client("viewer").historyAction({
			...request,
			runId: request.id,
			action: "select",
		}),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	expect(historyAction).toHaveBeenLastCalledWith("viewer", {
		projectId: request.projectId,
		nodeId: request.nodeId,
		runId: request.id,
		action: "select",
	});
});
