import { creditPack } from "./catalog";

type Checkout = {
	externalCustomerId: string | null;
	productId: string | null;
	status: string;
};

export function ownedCheckoutStatus(checkout: Checkout, userId: string) {
	if (
		checkout.externalCustomerId !== userId ||
		checkout.productId !== creditPack.productId
	) {
		return "unavailable" as const;
	}
	return checkout.status === "succeeded"
		? ("paid" as const)
		: ("pending" as const);
}
