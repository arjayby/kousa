import { createBilling } from "@kousa/billing/runtime";
import { handlePolarWebhook } from "@kousa/billing/webhook";
import { env } from "@kousa/env/server";
import { useLogger, withEvlog } from "@/lib/evlog";

export const POST = withEvlog(async (request: Request) => {
	return handlePolarWebhook(request, {
		secret: env.POLAR_WEBHOOK_SECRET,
		fulfill: (order) => createBilling().grantPaidOrder(order),
		onFailure: (code) => useLogger().set({ billing: { failure: code } }),
	});
});
