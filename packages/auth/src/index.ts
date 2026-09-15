import { creditPack } from "@kousa/billing/catalog";
import { createDb } from "@kousa/db";
import * as schema from "@kousa/db/schema/auth";
import { createEmail } from "@kousa/email/runtime";
import { verificationEmail } from "@kousa/email/templates";
import { env } from "@kousa/env/server";
import { checkout, polar, portal } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { polarClient } from "./lib/payments";

export function createAuth() {
	const db = createDb();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.BETTER_AUTH_URL],
		emailAndPassword: {
			enabled: true,
		},
		emailVerification: {
			expiresIn: 3600,
			sendVerificationEmail: async ({ user, url }) => {
				await createEmail().send(verificationEmail(user.email, url));
			},
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		plugins: [
			polar({
				client: polarClient,
				createCustomerOnSignUp: true,
				use: [
					checkout({
						products: [
							{
								productId: creditPack.productId,
								slug: creditPack.slug,
							},
						],
						successUrl: env.POLAR_SUCCESS_URL,
						authenticatedUsersOnly: true,
					}),
					portal(),
				],
			}),
			nextCookies(),
		],
	});
}
