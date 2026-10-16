import {
  workspaceIdSchema,
  workspaceSchema,
  type WorkspaceId,
} from "@kousa/api/modules/workspaces/contract";
import { ORPCError } from "@orpc/client";
import type { Mutation, Query, QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";

import { orpc } from "@/utils/orpc";

export function refreshWorkspace(queryClient: QueryClient, workspaceId: WorkspaceId) {
  return Promise.all([
    queryClient.invalidateQueries({
      predicate: (query) => query.meta?.workspaceId === workspaceId,
    }),
    queryClient.invalidateQueries({ queryKey: orpc.workspaces.list.key() }),
  ]);
}

const accessErrorSchema = z.object({ code: z.enum(["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"]) });

export function isAccessFailure(error: unknown) {
  return accessErrorSchema.safeParse(error).success;
}

function mutationWorkspaceId(mutation: Mutation) {
  if (mutation.options.meta?.workspaceResult) {
    const workspace = workspaceSchema.safeParse(mutation.state.data);
    return workspace.success ? workspace.data.id : undefined;
  }
  return mutation.options.meta?.workspaceId;
}

function clearWorkspaceData(
  queryClient: QueryClient,
  workspaceId: WorkspaceId,
  access: "none" | "member" = "none",
) {
  const ownerOnly = access === "member";
  const scope = {
    predicate: (query: Query) =>
      query.meta?.workspaceId === workspaceId && (!ownerOnly || query.meta.requiresOwner === true),
  };
  void queryClient.cancelQueries(scope, { revert: false, silent: true });
  const error = new ORPCError(ownerOnly ? "FORBIDDEN" : "NOT_FOUND", {
    message: ownerOnly
      ? "Owner access is no longer available."
      : "Your access to this workspace has ended.",
  });
  for (const query of queryClient.getQueryCache().findAll(scope)) {
    query.setState({ data: undefined, status: "error", error });
    if (query.getObserversCount() === 0)
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  }
  for (const mutation of queryClient.getMutationCache().findAll({
    predicate: (item) =>
      mutationWorkspaceId(item) === workspaceId &&
      (!ownerOnly || item.options.meta?.requiresOwner === true),
  })) {
    queryClient.getMutationCache().remove(mutation);
  }
}

export async function forgetWorkspace(queryClient: QueryClient, workspaceId: WorkspaceId) {
  clearWorkspaceData(queryClient, workspaceId);
  await queryClient.invalidateQueries({ queryKey: orpc.workspaces.list.key() });
}

export function useWorkspaceAccessCache() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated") return;
        const { query, action } = event;
        const id = workspaceIdSchema.safeParse(query.meta?.workspaceId);
        if (action.type === "error" && id.success && isAccessFailure(action.error)) {
          if (
            query.meta?.requiresOwner &&
            accessErrorSchema.parse(action.error).code === "FORBIDDEN"
          ) {
            clearWorkspaceData(queryClient, id.data, "member");
            void queryClient.invalidateQueries({
              queryKey: orpc.workspaces.get.queryOptions({ input: { workspaceId: id.data } })
                .queryKey,
            });
          } else void forgetWorkspace(queryClient, id.data);
          return;
        }
        if (action.type !== "success") return;
        if (query.meta?.workspaceSummary) {
          const workspace = workspaceSchema.parse(query.state.data);
          if (workspace.role !== "owner") clearWorkspaceData(queryClient, workspace.id, "member");
        }
        if (!query.meta?.workspaceList) return;
        const memberships = workspaceSchema.array().parse(query.state.data);
        const accessible = new Map(memberships.map((workspace) => [workspace.id, workspace.role]));
        const cachedIds = new Set([
          ...queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.meta?.workspaceId),
          ...queryClient.getMutationCache().getAll().map(mutationWorkspaceId),
        ]);
        for (const value of cachedIds) {
          const id = workspaceIdSchema.safeParse(value);
          if (!id.success) continue;
          const role = accessible.get(id.data);
          if (!role) clearWorkspaceData(queryClient, id.data);
          else if (role !== "owner") clearWorkspaceData(queryClient, id.data, "member");
        }
      }),
    [queryClient],
  );
}
