import { createAuth } from "@kousa/auth";
import { polarClient } from "@kousa/auth/lib/payments";
import { ownedCheckoutStatus } from "@kousa/billing/checkout";
import { createBilling } from "@kousa/billing/runtime";
import { buttonVariants } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

export const metadata = { referrer: "no-referrer" as const };

export default async function SuccessPage({
	searchParams,
}: {
	searchParams: Promise<{
		checkout_id?: string;
		customer_session_token?: string;
	}>;
}) {
	const params = await searchParams;
	const checkoutId = z.uuid().safeParse(params.checkout_id);
	// Kousa uses its own session, not Polar's optional customer-session token.
	if (params.customer_session_token) {
		redirect(
			checkoutId.success
				? `/success?checkout_id=${checkoutId.data}`
				: "/success",
		);
	}
	const session = await createAuth().api.getSession({
		headers: await headers(),
	});
	if (!session?.user) redirect("/login");

	let title = "Payment could not be verified";
	let message = "Check your purchases for the current payment status.";
	if (checkoutId.success) {
		try {
			const checkout = await polarClient.checkouts.get({ id: checkoutId.data });
			const status = ownedCheckoutStatus(checkout, session.user.id);
			if (status === "paid") {
				const grant = await createBilling().findCheckoutGrant(
					session.user.id,
					checkoutId.data,
				);
				title = "Payment successful";
				message = grant
					? `${grant.credits} credits have been added to your balance.`
					: "Your payment is confirmed. Your credits are pending. Check your balance shortly.";
			} else if (status === "pending") {
				title = "Payment pending";
				message =
					"Your payment has not completed yet. Check your purchases before trying again.";
			}
		} catch {
			// Do not expose provider errors or another customer's checkout information.
		}
	}

	return (
		<main className="container mx-auto px-4 py-8">
			<Card className="max-w-lg">
				<CardHeader>
					<CardTitle>
						<h1>{title}</h1>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p>{message}</p>
				</CardContent>
				<CardFooter>
					<Link href="/dashboard" className={buttonVariants()}>
						Back to dashboard
					</Link>
				</CardFooter>
			</Card>
		</main>
	);
}
