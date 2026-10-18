import { workspaceIdSchema } from "@kousa/api/modules/workspaces/contract";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { WorkspaceScreen } from "@/features/workspaces/components/workspace-screen";
import { WebsiteList } from "@/features/websites/components/website-list";

export const Route = createFileRoute("/_auth/workspaces/$workspaceId")({
  params: {
    parse: (params) => {
      const parsed = workspaceIdSchema.safeParse(params.workspaceId);
      if (!parsed.success) throw notFound();
      return { workspaceId: parsed.data };
    },
  },
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { workspaceId } = Route.useParams();
  return (
    <WorkspaceScreen key={workspaceId} workspaceId={workspaceId}>
      <WebsiteList workspaceId={workspaceId} />
    </WorkspaceScreen>
  );
}
