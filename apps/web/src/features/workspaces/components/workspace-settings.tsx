import { workspaceNameSchema, type WorkspaceId } from "@kousa/api/modules/workspaces/contract";
import { Button } from "@kousa/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kousa/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

import { refreshWorkspace } from "../api/cache";

export function WorkspaceSettings({
  workspaceId,
  name,
}: {
  workspaceId: WorkspaceId;
  name: string;
}) {
  const queryClient = useQueryClient();
  const rename = useMutation({
    ...orpc.workspaces.rename.mutationOptions(),
    meta: { workspaceId, requiresOwner: true },
    onSuccess: () => refreshWorkspace(queryClient, workspaceId),
    onError: () => refreshWorkspace(queryClient, workspaceId),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Workspace settings</h2>
        </CardTitle>
        <CardDescription>Only the Owner can change the workspace name.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = workspaceNameSchema.safeParse(
              new FormData(event.currentTarget).get("name"),
            );
            if (parsed.success) rename.mutate({ workspaceId, name: parsed.data });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-workspace-name">New workspace name</FieldLabel>
              <Input
                key={name}
                id="new-workspace-name"
                name="name"
                defaultValue={name}
                required
                maxLength={100}
              />
            </Field>
            {rename.isError ? <p role="alert">{rename.error.message}</p> : null}
            <Button type="submit" disabled={rename.isPending}>
              Save workspace name
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
