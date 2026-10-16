import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { authRedirectSchema } from "@/lib/auth-redirect";
import { useWorkspaceAccessCache } from "@/features/workspaces/api/cache";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
        search: { redirect: authRedirectSchema.parse(location.href) },
      });
    }
    return { session };
  },
});

function AuthLayout() {
  useWorkspaceAccessCache();
  return <Outlet />;
}
