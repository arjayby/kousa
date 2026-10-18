import { websiteIdSchema, workspaceIdSchema } from "@kousa/api/modules/workspaces/contract";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { WebsiteScreen } from "@/features/websites/components/website-screen";

export const Route = createFileRoute("/_auth/workspaces/$workspaceId_/websites/$websiteId")({
  params: {
    parse: (params) => {
      const workspaceId = workspaceIdSchema.safeParse(params.workspaceId);
      const websiteId = websiteIdSchema.safeParse(params.websiteId);
      if (!workspaceId.success || !websiteId.success) throw notFound();
      return { workspaceId: workspaceId.data, websiteId: websiteId.data };
    },
  },
  component: WebsiteRoute,
});

function WebsiteRoute() {
  const { workspaceId, websiteId } = Route.useParams();
  return (
    <WebsiteScreen
      key={`${workspaceId}:${websiteId}`}
      workspaceId={workspaceId}
      websiteId={websiteId}
    />
  );
}
