"use client";
import { creditPack } from "@kousa/billing/catalog";
import { Button } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export default function Dashboard({
	userId,
	initialBalance,
}: {
	userId: string;
	initialBalance: number;
}) {
	const credits = useQuery({
		...orpc.credits.summary.queryOptions(),
		// Keep a previous account's balance out of this account's query cache.
		queryKey: ["credits", userId],
		initialData: { balance: initialBalance },
	});
	const [pending, setPending] = useState<"checkout" | "portal" | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function openBilling(destination: "checkout" | "portal") {
		setPending(destination);
		setError(null);
		try {
			const result =
				destination === "checkout"
					? await authClient.checkout({ slug: creditPack.slug })
					: await authClient.customer.portal();
			if (result.error) throw new Error("Billing request failed");
		} catch {
			setError(
				destination === "checkout"
					? "Could not open checkout. Please try again."
					: "Could not open your purchases. Please try again.",
			);
		} finally {
			setPending(null);
		}
	}

	return (
		<Card className="max-w-lg">
			<CardHeader>
				<CardTitle>Credits</CardTitle>
				<CardDescription>
					Your balance for generating media in Kousa.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p aria-live="polite" className="font-semibold text-3xl tabular-nums">
					{credits.data.balance.toLocaleString("en-US")}{" "}
					<span className="font-normal text-muted-foreground text-sm">
						credits
					</span>
				</p>
				<p className="text-muted-foreground">
					{creditPack.credits} credits for $5 USD. One-time purchase.
				</p>
				<p className="text-muted-foreground">Sandbox payments are enabled.</p>
				{credits.isError && (
					<p role="alert">
						Could not refresh your balance. Showing the last available balance.
					</p>
				)}
				{error && <p role="alert">{error}</p>}
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				<Button
					disabled={pending !== null}
					onClick={() => openBilling("checkout")}
				>
					{pending === "checkout"
						? "Opening checkout…"
						: `Buy ${creditPack.credits} credits`}
				</Button>
				<Button
					variant="outline"
					disabled={pending !== null}
					onClick={() => openBilling("portal")}
				>
					{pending === "portal" ? "Opening purchases…" : "View purchases"}
				</Button>
				<Button
					variant="ghost"
					disabled={credits.isFetching}
					onClick={() => credits.refetch()}
				>
					{credits.isFetching ? "Refreshing…" : "Refresh balance"}
				</Button>
			</CardFooter>
		</Card>
	);
}
