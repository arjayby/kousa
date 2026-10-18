import { workspaceIdSchema, type WorkspaceId } from "@kousa/api/modules/workspaces/contract";
import { Alert, AlertDescription, AlertTitle } from "@kousa/ui/components/alert";
import { Badge } from "@kousa/ui/components/badge";
import { Button } from "@kousa/ui/components/button";
import { Field, FieldLabel } from "@kousa/ui/components/field";
import { NativeSelect, NativeSelectOption } from "@kousa/ui/components/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { orpc } from "@/utils/orpc";
import { OwnerTeam } from "./owner-team";
import { WorkspaceSettings } from "./workspace-settings";
import { forgetWorkspace, refreshWorkspace } from "../api/cache";

export function WorkspaceScreen({
  workspaceId,
  children,
}: {
  workspaceId: WorkspaceId;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspace = useQuery(
    orpc.workspaces.get.queryOptions({
      input: { workspaceId },
      retry: false,
      meta: { workspaceId, workspaceSummary: true },
    }),
  );
  const memberships = useQuery(
    orpc.workspaces.list.queryOptions({ meta: { workspaceList: true } }),
  );
  const leave = useMutation({
    ...orpc.workspaces.leave.mutationOptions(),
    onSuccess: async () => {
      await forgetWorkspace(queryClient, workspaceId);
      await navigate({ to: "/dashboard" });
    },
    onError: () => refreshWorkspace(queryClient, workspaceId),
    meta: { workspaceId },
  });

  if (workspace.isPending)
    return (
      <main className="p-6" aria-busy="true">
        Loading workspace...
      </main>
    );
  if (workspace.isError)
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <Alert variant="destructive">
          <AlertTitle>Workspace unavailable</AlertTitle>
          <AlertDescription>{workspace.error.message}</AlertDescription>
        </Alert>
        <Link to="/dashboard">All workspaces</Link>
      </main>
    );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <nav
        className="flex flex-wrap items-center justify-between gap-4"
        aria-label="Workspace navigation"
      >
        <Link to="/dashboard">All workspaces</Link>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="workspace-switch">Switch workspace</FieldLabel>
          <NativeSelect
            id="workspace-switch"
            value={workspaceId}
            onChange={(event) => {
              const id = workspaceIdSchema.parse(event.target.value);
              void navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: id } });
            }}
          >
            {(memberships.data ?? []).map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </nav>
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{workspace.data.name}</h1>
        <Badge variant="secondary">{workspace.data.role}</Badge>
      </header>
      <Button
        variant="outline"
        disabled={workspace.isFetching}
        onClick={() => {
          void refreshWorkspace(queryClient, workspaceId);
        }}
      >
        Refresh workspace
      </Button>
      {children}
      {workspace.data.role === "owner" ? (
        <>
          <WorkspaceSettings workspaceId={workspaceId} name={workspace.data.name} />
          <OwnerTeam workspaceId={workspaceId} />
        </>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Your membership">
          <p>Your {workspace.data.role} access applies to every website in this workspace.</p>
          {leave.isError ? <p role="alert">{leave.error.message}</p> : null}
          <Button
            variant="outline"
            disabled={leave.isPending}
            onClick={() => leave.mutate({ workspaceId })}
          >
            Leave workspace
          </Button>
        </section>
      )}
    </main>
  );
}
