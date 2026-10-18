import type { WorkspaceId } from "@kousa/api/modules/workspaces/contract";
import { Alert, AlertDescription, AlertTitle } from "@kousa/ui/components/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kousa/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@kousa/ui/components/empty";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";
import { websiteListOptions } from "../api/queries";
import { WebsiteForm } from "./website-form";

export function WebsiteList({ workspaceId }: { workspaceId: WorkspaceId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspace = useQuery(
    orpc.workspaces.get.queryOptions({
      input: { workspaceId },
      meta: { workspaceId, workspaceSummary: true },
      retry: false,
    }),
  );
  const websites = useQuery(websiteListOptions(workspaceId));
  const create = useMutation({
    ...orpc.websites.create.mutationOptions(),
    meta: { workspaceId },
    onSuccess: async (website) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.websites.list.key({ input: { workspaceId } }),
      });
      await navigate({
        to: "/workspaces/$workspaceId/websites/$websiteId",
        params: { workspaceId, websiteId: website.id },
      });
    },
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.workspaces.get.queryOptions({ input: { workspaceId } }).queryKey,
      }),
  });
  const canConfigure = workspace.data?.role === "owner" || workspace.data?.role === "admin";
  return (
    <section className="flex flex-col gap-4" aria-label="Websites">
      <h2 className="text-xl font-semibold">Websites</h2>
      {websites.isPending ? <p aria-busy="true">Loading websites...</p> : null}
      {websites.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load websites</AlertTitle>
          <AlertDescription>{websites.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {websites.data?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No websites yet</EmptyTitle>
            <EmptyDescription>
              {canConfigure
                ? "Create a website below to save its setup and prepare installation instructions."
                : "Ask an Owner or Admin to create a website for this workspace."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <nav className="flex flex-col gap-2" aria-label="Workspace websites">
        {websites.data?.map((website) => (
          <Link
            key={website.id}
            to="/workspaces/$workspaceId/websites/$websiteId"
            params={{ workspaceId, websiteId: website.id }}
            className="flex flex-wrap items-center justify-between gap-2 border p-4"
          >
            <span>{website.name}</span>
            <span className="break-all text-muted-foreground">{website.hostname}</span>
          </Link>
        ))}
      </nav>
      {canConfigure ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Create a website</h3>
            </CardTitle>
            <CardDescription>
              Register a hostname for this workspace. Registration does not verify ownership.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WebsiteForm
              initialValues={null}
              onSave={(values) => create.mutate({ workspaceId, ...values })}
              pending={create.isPending}
              error={create.error}
              submitLabel="Create website"
            />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
