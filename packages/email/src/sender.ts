import { z } from "zod";

export type EmailContent = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};
export type EmailReceipt = { messageId: string | null };

export class EmailDeliveryError extends Error {
	constructor(
		public readonly code: "not_configured" | "rejected" | "unconfirmed",
	) {
		super(
			code === "not_configured"
				? "Email delivery is not configured."
				: code === "rejected"
					? "The email provider rejected this message."
					: "Email delivery could not be confirmed.",
		);
	}
}

export function createEmailSender(options: {
	from?: string;
	apiKey?: string;
	fetch?: typeof fetch;
}) {
	const from = z.email().safeParse(options.from);
	const apiKey = options.apiKey?.trim();
	const isConfigured = () => from.success && Boolean(apiKey);
	return {
		isConfigured,
		async send(content: EmailContent): Promise<EmailReceipt> {
			if (!isConfigured() || !from.success)
				throw new EmailDeliveryError("not_configured");
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 20_000);
			try {
				const body = JSON.stringify({
					from: from.data,
					to: [content.to],
					subject: content.subject,
					text: content.text,
					html: content.html,
				});
				// The private link makes each invitation/verification attempt unique.
				// Hash the payload so the idempotency key exposes no recipient or token.
				const digest = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(body),
				);
				const key = Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
				const response = await (options.fetch ?? fetch)(
					"https://api.resend.com/emails",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${apiKey}`,
							"Content-Type": "application/json",
							"Idempotency-Key": `kousa/${key}`,
						},
						body,
						signal: controller.signal,
					},
				);
				if (!response.ok)
					throw new EmailDeliveryError(
						response.status >= 500 || response.status === 409
							? "unconfirmed"
							: "rejected",
					);
				const result = z
					.object({ id: z.string().min(1) })
					.safeParse(await response.json());
				if (!result.success) throw new EmailDeliveryError("unconfirmed");
				return { messageId: result.data.id };
			} catch (error) {
				if (error instanceof EmailDeliveryError) throw error;
				// Provider errors can contain recipient addresses or message bodies.
				throw new EmailDeliveryError("unconfirmed");
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

export type EmailSender = ReturnType<typeof createEmailSender>;
