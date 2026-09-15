import type { CreditStore } from "@kousa/db/credit-store";
import { z } from "zod";
import { creditPack } from "./catalog";

const paidOrderSchema = z
	.object({
		id: z.uuid(),
		checkout_id: z.uuid(),
		customer_id: z.uuid(),
		product_id: z.literal(creditPack.productId),
		paid: z.literal(true),
		status: z.literal("paid"),
		billing_reason: z.literal("purchase"),
		subscription_id: z.null(),
		net_amount: z.literal(creditPack.amount),
		currency: z.literal(creditPack.currency),
		refunded_amount: z.literal(0),
		customer: z.object({
			id: z.uuid(),
			external_id: z.string().min(1),
		}),
	})
	.refine((order) => order.customer_id === order.customer.id);

export class InvalidCreditOrderError extends Error {
	constructor() {
		super("Paid order does not match the configured credit pack or customer.");
	}
}

export function createCreditLedger(store: CreditStore) {
	return {
		async grantPaidOrder(data: unknown) {
			const product = z
				.object({ product_id: z.string().nullable() })
				.safeParse(data);
			if (product.success && product.data.product_id !== creditPack.productId) {
				return { status: "ignored" } as const;
			}
			const parsed = paidOrderSchema.safeParse(data);
			if (!parsed.success) throw new InvalidCreditOrderError();
			const order = parsed.data;

			const inserted = await store.grant({
				userId: order.customer.external_id,
				polarOrderId: order.id,
				polarCheckoutId: order.checkout_id,
				polarCustomerId: order.customer_id,
				polarProductId: order.product_id,
				credits: creditPack.credits,
				amount: order.net_amount,
				currency: order.currency,
			});

			return { status: inserted ? "granted" : "duplicate" } as const;
		},

		summary: store.summary,
		findCheckoutGrant: store.findCheckoutGrant,
	};
}
