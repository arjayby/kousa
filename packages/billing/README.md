# Credit fulfillment

The sandbox product in `src/catalog.ts` grants 500 credits for a one-time $5 USD purchase. Changing the number of credits affects future orders only. Existing grants retain their recorded value.

## Delivery

`POST /api/webhooks/polar` verifies the raw body, signature and timestamp before reading the event. It supports both Standard Webhooks keys and Polar's older signing format, including older CLI secrets. The endpoint intentionally does not use the scaffold's Polar SDK 0.x verification helper, which only supports the old signing format.

Configure a Polar **sandbox** endpoint for `order.paid` and save its signing secret as `POLAR_WEBHOOK_SECRET` in `apps/web/.env`. Alchemy passes it to local Next.js and to the deployed Cloudflare Worker. Restart `pnpm dev` after changing the secret. A missing secret returns 503 without processing anything.

For local development, use the [Polar CLI forwarding workflow](https://polar.sh/docs/integrate/webhooks/locally) with CLI 1.3.9 or newer. Older versions reject the current event format with `Failed to decode event` before forwarding it. Run:

```sh
polar listen http://localhost:3001/api/webhooks/polar
```

Select the sandbox environment and the Kousa organization. Use the signing secret emitted by that listener. Keep it running while testing. Production needs a permanent HTTPS endpoint and a separate production signing secret, access token, and product.

Do not add the Better Auth webhook plugin alongside this route; configure one fulfillment endpoint.

## Guarantees

- Only the allowlisted product, paid one-time orders, USD currency, and the configured $5 net amount are accepted. Discounts, recurring payments, and already-refunded payloads are rejected until their policies are implemented.
- `customer.external_id` maps to the Better Auth user ID. The database requires that user to exist. Client metadata, email addresses and URL parameters cannot choose the credited account or amount.
- Each grant is one atomic insert. A unique Polar order ID prevents double grants across retries or concurrent deliveries. A unique checkout ID also prevents a second order being attached to the same one-time checkout.
- Failed database writes return 500 so Polar can retry. Invalid signatures return 403; invalid known-product orders return 422. Other signed events/products are acknowledged without creating credits.
- The protected oRPC summary always uses the authenticated user's ID. The success page checks the checkout with Polar and verifies ownership; it never issues credits from a redirect or query parameter.
- Stored data is limited to IDs, credit amounts, currency and timestamps. Webhook bodies, signatures and customer billing details are not persisted in the ledger or logged by the handler.

## Tests

Run `pnpm test` from the repository root. Tests run the real Drizzle migrations and SQL against an isolated PGlite Postgres engine. No cloud credentials or paid services are needed.

Tests cover concurrent duplicate orders with distinct delivery IDs, repeat purchases, invalid signatures and timestamps, account isolation, invalid order amounts, missing users, database retry behavior, and checkout ownership.

## Remaining billing work

This package currently records purchase grants only. Generation reservations/debits, refunds, chargebacks, team balances, and automatic reconciliation of missed historical orders are not implemented. Keep billing in sandbox until those policies and handlers are ready. A payment made before the endpoint was configured has no grant until its verified `order.paid` event is delivered; showing the success page does not backfill it.

See [Polar's signature and retry documentation](https://polar.sh/docs/integrate/webhooks/delivery).
