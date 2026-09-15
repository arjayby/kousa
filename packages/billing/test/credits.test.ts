import { createCreditTestDatabase } from "@kousa/db/testing";
import { Webhook } from "standardwebhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { creditPack } from "../src/catalog";
import { ownedCheckoutStatus } from "../src/checkout";
import { createCreditLedger } from "../src/ledger";
import { handlePolarWebhook } from "../src/webhook";

let database: Awaited<ReturnType<typeof createCreditTestDatabase>>;
let ledger: ReturnType<typeof createCreditLedger>;
const secret = `whsec_${Buffer.from("kousa-test-only-signing-secret-32bytes").toString("base64")}`;
const signing = new Webhook(secret);
const customerId = "05b8e410-773d-41f4-b2dd-d874531969a5";

function paidOrder(overrides: Record<string, unknown> = {}) {
	return {
		id: crypto.randomUUID(),
		checkout_id: crypto.randomUUID(),
		customer_id: customerId,
		product_id: creditPack.productId,
		paid: true,
		status: "paid",
		billing_reason: "purchase",
		subscription_id: null,
		net_amount: 500,
		currency: "usd",
		refunded_amount: 0,
		customer: { id: customerId, external_id: "user-a" },
		...overrides,
	};
}

function signedRequest(
	data: unknown,
	options: { type?: string; timestamp?: Date; tamper?: boolean } = {},
) {
	const body = JSON.stringify({ type: options.type ?? "order.paid", data });
	const id = crypto.randomUUID();
	const timestamp = options.timestamp ?? new Date();
	return new Request("https://kousa.test/api/webhooks/polar", {
		method: "POST",
		body: options.tamper ? `${body} ` : body,
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
			"webhook-signature": signing.sign(id, timestamp, body),
		},
	});
}

function deliver(data: unknown, options?: Parameters<typeof signedRequest>[1]) {
	return handlePolarWebhook(signedRequest(data, options), {
		secret,
		fulfill: ledger.grantPaidOrder,
	});
}

beforeAll(async () => {
	// Exercise the checked-in SQL rather than a test-only copy of the schema.
	database = await createCreditTestDatabase();
	ledger = createCreditLedger(database.store);
	await database.addUsers([
		{ id: "user-a", name: "Test A", email: "a@example.test" },
		{ id: "user-b", name: "Test B", email: "b@example.test" },
	]);
}, 30000);
beforeEach(async () => {
	await database.clearGrants();
});
afterAll(async () => {
	await database.close();
});

describe("paid credit grants", () => {
	it("adds 500 credits only to the mapped customer", async () => {
		const order = paidOrder();
		expect(await (await deliver(order)).json()).toEqual({ status: "granted" });
		expect(await ledger.summary("user-a")).toEqual({ balance: 500 });
		expect(await ledger.summary("user-b")).toEqual({ balance: 0 });
		expect(
			await ledger.findCheckoutGrant("user-b", order.checkout_id),
		).toBeNull();
	});

	it("grants once when the same order arrives concurrently under different delivery IDs", async () => {
		const order = paidOrder();
		const responses = await Promise.all(
			Array.from({ length: 8 }, () => deliver(order)),
		);
		const bodies = await Promise.all(
			responses.map(async (response) =>
				z.object({ status: z.string() }).parse(await response.json()),
			),
		);
		expect(bodies.filter((body) => body.status === "granted")).toHaveLength(1);
		expect(bodies.filter((body) => body.status === "duplicate")).toHaveLength(
			7,
		);
		expect(await ledger.summary("user-a")).toEqual({ balance: 500 });
	});

	it("allows another purchase of the same pack", async () => {
		await deliver(paidOrder());
		await deliver(paidOrder());
		expect(await ledger.summary("user-a")).toEqual({ balance: 1000 });
	});

	it("does not acknowledge a failed write and allows a later retry", async () => {
		const order = paidOrder({
			customer: { id: customerId, external_id: "late-user" },
		});
		expect((await deliver(order)).status).toBe(500);
		await database.addUsers([
			{ id: "late-user", name: "Late", email: "late@example.test" },
		]);
		expect(await (await deliver(order)).json()).toEqual({ status: "granted" });
		expect(await ledger.summary("late-user")).toEqual({ balance: 500 });
	});

	it.each([
		{ paid: false },
		{ status: "pending" },
		{ net_amount: 1 },
		{ currency: "eur" },
		{ subscription_id: crypto.randomUUID() },
		{ refunded_amount: 100 },
		{ customer: { id: customerId, external_id: null } },
		{ customer_id: crypto.randomUUID() },
	])("rejects an invalid paid order: %j", async (overrides) => {
		expect((await deliver(paidOrder(overrides))).status).toBe(422);
		expect(await ledger.summary("user-a")).toEqual({ balance: 0 });
	});

	it("ignores other products and unrelated events", async () => {
		expect(
			await (
				await deliver(paidOrder({ product_id: crypto.randomUUID() }))
			).json(),
		).toEqual({ status: "ignored" });
		expect(
			await (await deliver(paidOrder(), { type: "order.created" })).json(),
		).toEqual({ status: "ignored" });
		expect(await ledger.summary("user-a")).toEqual({ balance: 0 });
	});
});

describe("webhook verification", () => {
	it("accepts Polar's legacy CLI signing format", async () => {
		const legacySecret = "legacy-polar-cli-secret-for-tests";
		const body = JSON.stringify({ type: "order.paid", data: paidOrder() });
		const id = crypto.randomUUID();
		const timestamp = new Date();
		const legacySigner = new Webhook(
			Buffer.from(legacySecret).toString("base64"),
		);
		const request = new Request("https://kousa.test/api/webhooks/polar", {
			method: "POST",
			body,
			headers: {
				"webhook-id": id,
				"webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
				"webhook-signature": legacySigner.sign(id, timestamp, body),
			},
		});
		expect(
			await (
				await handlePolarWebhook(request, {
					secret: legacySecret,
					fulfill: ledger.grantPaidOrder,
				})
			).json(),
		).toEqual({ status: "granted" });
	});

	it("rejects unsigned, tampered, stale, and wrongly signed deliveries", async () => {
		const requests = [
			new Request("https://kousa.test/api/webhooks/polar", {
				method: "POST",
				body: JSON.stringify(paidOrder()),
			}),
			signedRequest(paidOrder(), { tamper: true }),
			signedRequest(paidOrder(), { timestamp: new Date(Date.now() - 600_000) }),
		];
		const wrongKey = signedRequest(paidOrder());
		wrongKey.headers.set("webhook-signature", "v1,aW52YWxpZA==");
		requests.push(wrongKey);
		for (const request of requests) {
			expect(
				(
					await handlePolarWebhook(request, {
						secret,
						fulfill: ledger.grantPaidOrder,
					})
				).status,
			).toBe(403);
		}
		expect(await ledger.summary("user-a")).toEqual({ balance: 0 });
	});

	it("fails closed when no signing secret is configured", async () => {
		const response = await handlePolarWebhook(signedRequest(paidOrder()), {
			secret: undefined,
			fulfill: ledger.grantPaidOrder,
		});
		expect(response.status).toBe(503);
		expect(await ledger.summary("user-a")).toEqual({ balance: 0 });
	});
});

describe("checkout ownership", () => {
	const checkout = {
		externalCustomerId: "user-a",
		productId: creditPack.productId,
		status: "succeeded",
	};
	it("shows a paid checkout only to its owner", () => {
		expect(ownedCheckoutStatus(checkout, "user-a")).toBe("paid");
		expect(ownedCheckoutStatus(checkout, "user-b")).toBe("unavailable");
	});
	it("does not claim unpaid or unrelated checkouts succeeded", () => {
		expect(ownedCheckoutStatus({ ...checkout, status: "open" }, "user-a")).toBe(
			"pending",
		);
		expect(
			ownedCheckoutStatus(
				{ ...checkout, productId: "other-product" },
				"user-a",
			),
		).toBe("unavailable");
	});
});
