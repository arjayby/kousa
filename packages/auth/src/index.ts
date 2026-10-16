import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@kousa/db";
import type { DatabaseConfig } from "@kousa/db/config";
import * as schema from "@kousa/db/schema/auth";
import { polar, checkout, portal } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";

import { createPolarClient } from "./lib/payments";
import { sendLocalVerificationEmail } from "./lib/verification-email";

export type AuthConfig = {
  DATABASE_MODE: DatabaseConfig["DATABASE_MODE"];
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  POLAR_ACCESS_TOKEN: string;
  POLAR_SUCCESS_URL: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const local = env.DATABASE_MODE === "local";
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    emailVerification: local
      ? {
          sendVerificationEmail: ({ user, url }) =>
            sendLocalVerificationEmail({ email: user.email, url }),
        }
      : undefined,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: local ? "lax" : "none",
        secure: !local,
        httpOnly: true,
      },
    },
    plugins: local
      ? []
      : [
          polar({
            client: createPolarClient(env),
            createCustomerOnSignUp: true,
            use: [
              checkout({
                products: [{ productId: "ffd28cbf-8918-474f-bf23-57ced81eebf2", slug: "pro" }],
                successUrl: env.POLAR_SUCCESS_URL,
                authenticatedUsersOnly: true,
              }),
              portal(),
            ],
          }),
        ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
