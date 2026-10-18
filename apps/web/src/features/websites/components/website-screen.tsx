import type { Website } from "@kousa/api/modules/websites/contract";
import type { WorkspaceId } from "@kousa/api/modules/workspaces/contract";
import { Alert, AlertDescription, AlertTitle } from "@kousa/ui/components/alert";
import { Badge } from "@kousa/ui/components/badge";
import { Button } from "@kousa/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kousa/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";
import { installationOptions, websiteOptions } from "../api/queries";
import { InstallationInstructions } from "./installation-instructions";
import { WebsiteForm } from "./website-form";

export function WebsiteScreen({
  workspaceId,
  websiteId,
}: {
  workspaceId: WorkspaceId;
  websiteId: Website["id"];
}) {
  const queryClient = useQueryClient();
  const workspace = useQuery(
    orpc.workspaces.get.queryOptions({
      input: { workspaceId },
      meta: { workspaceId, workspaceSummary: true },
      retry: false,
    }),
  );
  const website = useQuery(websiteOptions(workspaceId, websiteId));
  const installation = useQuery(installationOptions(workspaceId, websiteId));
  const update = useMutation({
    ...orpc.websites.update.mutationOptions(),
    meta: { workspaceId },
    onSuccess: async (saved) => {
      queryClient.setQueryData(websiteOptions(workspaceId, websiteId).queryKey, saved);
      await queryClient.invalidateQueries({
        queryKey: orpc.websites.list.key({ input: { workspaceId } }),
      });
    },
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.workspaces.get.queryOptions({ input: { workspaceId } }).queryKey,
      }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) => query.meta?.workspaceId === workspaceId,
    });
  const back = (
    <Link to="/workspaces/$workspaceId" params={{ workspaceId }}>
      Back to websites
    </Link>
  );
  if (website.isError || workspace.isError)
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <Alert variant="destructive">
          <AlertTitle>Website unavailable</AlertTitle>
          <AlertDescription>{website.error?.message ?? workspace.error?.message}</AlertDescription>
        </Alert>
        {back}
        <Link to="/dashboard">All workspaces</Link>
      </main>
    );
  if (website.isPending || workspace.isPending)
    return (
      <main className="p-6" aria-busy="true">
        Loading website...
      </main>
    );
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <nav
        className="flex flex-wrap items-center justify-between gap-4"
        aria-label="Website navigation"
      >
        {back}
        <span>{workspace.data.name}</span>
        <Link to="/dashboard">All workspaces</Link>
      </nav>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{website.data.name}</h1>
        <Badge variant="secondary">{workspace.data.role}</Badge>
      </header>
      <p>Saved hostname: {website.data.hostname}</p>
      <p>Website setup saved</p>
      <Button
        variant="outline"
        disabled={website.isFetching || workspace.isFetching}
        onClick={() => {
          void refresh();
        }}
      >
        Refresh website
      </Button>
      {workspace.data.role !== "viewer" ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Website settings</h2>
            </CardTitle>
            <CardDescription>
              Update this website&apos;s name or hostname. Its identifiers stay the same.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WebsiteForm
              key={`${website.data.name}:${website.data.hostname}`}
              initialValues={website.data}
              onSave={(values) => update.mutate({ workspaceId, websiteId, ...values })}
              pending={update.isPending}
              error={update.error}
              submitLabel="Save website"
            />
          </CardContent>
        </Card>
      ) : null}
      {installation.isPending ? (
        <p aria-busy="true">Loading installation instructions...</p>
      ) : installation.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Installation instructions unavailable</AlertTitle>
          <AlertDescription>{installation.error.message}</AlertDescription>
        </Alert>
      ) : (
        <InstallationInstructions installation={installation.data} />
      )}
    </main>
  );
}
