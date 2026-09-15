import { env } from "@kousa/env/server";
import { createEmailSender } from "./sender";

export function createEmail() {
	return createEmailSender({
		from: env.EMAIL_FROM,
		apiKey: env.RESEND_API_KEY,
	});
}
