import { createAuth } from "@kousa/auth";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";

import { useLogger } from "@/lib/evlog";

export async function identifyEvlogUser(request: Request) {
  const identifyUser = createAuthMiddleware(createAuth() as BetterAuthInstance, {
    exclude: ["/api/auth/**"],
    maskEmail: true,
  });
  await identifyUser(useLogger(), request.headers, new URL(request.url).pathname);
}
