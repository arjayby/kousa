import { invitationTokenSchema } from "@kousa/api/modules/workspaces/contract";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { InvitationScreen } from "@/features/workspaces/components/invitation-screen";

export const Route = createFileRoute("/_auth/invite/$token")({
  params: {
    parse: (params) => {
      const parsed = invitationTokenSchema.safeParse(params.token);
      if (!parsed.success) throw notFound();
      return { token: parsed.data };
    },
  },
  component: InvitationRoute,
});

function InvitationRoute() {
  const { token } = Route.useParams();
  return <InvitationScreen token={token} />;
}
