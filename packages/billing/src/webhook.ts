import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { z } from "zod";
import { InvalidCreditOrderError } from "./ledger";

type Fulfill = (
	data: unknown,
) => Promise<{ status: "granted" | "duplicate" | "ignored" }>;

function verify(
	body: string,
	headers: Record<string, string>,
	secret: string,
): unknown {
	let failure: unknown;
	// Polar switched signing keys on 2026-09-08. Also support legacy CLI secrets.
	for (const key of [secret, Buffer.from(secret, "utf8").toString("base64")]) {
		try {
			return new Webhook(key).verify(body, headers);
		} catch (error) {
			failure = error;
		}
	}
	throw failure;
}

// Never parse or write to the database before verifying the raw request body.
export async function handlePolarWebhook(
	request: Request,
	options: {
		secret: string | undefined;
		fulfill: Fulfill;
		onFailure?: (code: string) => void;
	},
): Promise<Response> {
	if (!options.secret)
		return Response.json(
			{ error: "Webhooks are not configured." },
			{ status: 503 },
		);

	let rawEvent: unknown;
	try {
		rawEvent = verify(
			await request.text(),
			Object.fromEntries(request.headers),
			options.secret,
		);
	} catch (error) {
		if (
			error instanceof WebhookVerificationError ||
			error instanceof SyntaxError
		) {
			return Response.json({ error: "Invalid webhook." }, { status: 403 });
		}
		options.onFailure?.("webhook_configuration_error");
		return Response.json({ error: "Webhook unavailable." }, { status: 503 });
	}

	const event = z
		.object({ type: z.string(), data: z.unknown() })
		.safeParse(rawEvent);
	if (!event.success)
		return Response.json({ error: "Invalid event." }, { status: 400 });
	if (event.data.type !== "order.paid")
		return Response.json({ status: "ignored" });

	try {
		const result = await options.fulfill(event.data.data);
		return Response.json(result);
	} catch (error) {
		if (error instanceof InvalidCreditOrderError) {
			options.onFailure?.("invalid_credit_order");
			return Response.json({ error: "Invalid credit order." }, { status: 422 });
		}
		// Do not acknowledge failed writes: Polar must retry them.
		// Never log the payload, signature, customer details, or database parameters.
		options.onFailure?.("credit_grant_failed");
		return Response.json({ error: "Credit grant failed." }, { status: 500 });
	}
}
