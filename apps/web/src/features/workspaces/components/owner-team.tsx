import {
  invitationEmailSchema,
  memberRoleSchema,
  type WorkspaceId,
} from "@kousa/api/modules/workspaces/contract";
import { Badge } from "@kousa/ui/components/badge";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";

import { orpc } from "@/utils/orpc";

import { isAccessFailure, refreshWorkspace } from "../api/cache";
import { MemberRolePicker } from "./member-role-picker";

export function OwnerTeam({ workspaceId }: { workspaceId: WorkspaceId }) {
  const queryClient = useQueryClient();
  const members = useQuery(
    orpc.workspaces.members.queryOptions({
      input: { workspaceId },
      retry: false,
      meta: { workspaceId, requiresOwner: true },
    }),
  );
  const invitations = useQuery(
    orpc.workspaces.invitations.queryOptions({
      input: { workspaceId },
      retry: false,
      meta: { workspaceId, requiresOwner: true },
    }),
  );
  const [role, setRole] = useState<z.infer<typeof memberRoleSchema>>("viewer");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const update = () => refreshWorkspace(queryClient, workspaceId);
  const setRoleMutation = useMutation({
    ...orpc.workspaces.setRole.mutationOptions(),
    meta: { workspaceId, requiresOwner: true },
    onSuccess: update,
    onError: update,
  });
  const transfer = useMutation({
    ...orpc.workspaces.transferOwnership.mutationOptions(),
    meta: { workspaceId, requiresOwner: true },
    onSuccess: update,
    onError: update,
  });
  const remove = useMutation({
    ...orpc.workspaces.removeMember.mutationOptions(),
    meta: { workspaceId, requiresOwner: true },
    onSuccess: update,
    onError: update,
  });
  const issue = useMutation({
    ...orpc.workspaces.invite.mutationOptions(),
    meta: { workspaceId, requiresOwner: true },
    onError: update,
    onSuccess: () => {
      setCopied(false);
      setCopyFailed(false);
      return refreshWorkspace(queryClient, workspaceId);
    },
  });
  const revoke = useMutation({
    ...orpc.workspaces.revokeInvitation.mutationOptions(),
    meta: { workspaceId, requiresOwner: true },
    onError: update,
    onSuccess: () => refreshWorkspace(queryClient, workspaceId),
  });
  const link = issue.data ? `${window.location.origin}/invite/${issue.data.token}` : "";
  const ownerAccessLost = isAccessFailure(members.error) || isAccessFailure(invitations.error);
  const resetIssue = issue.reset;
  useEffect(() => {
    if (ownerAccessLost) resetIssue();
  }, [ownerAccessLost, resetIssue]);

  if (ownerAccessLost) return <p role="alert">Owner access is no longer available.</p>;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Members</h2>
          </CardTitle>
          <CardDescription>Roles apply to every website in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.isError ? <p role="alert">{members.error.message}</p> : null}
          <p className="mb-4 text-muted-foreground">
            Transferring ownership makes you an Admin and cancels all pending invitations.
          </p>
          {[setRoleMutation.error, transfer.error, remove.error]
            .filter((error) => error !== null)
            .map((error) => (
              <p key={error.message} role="alert">
                {error.message}
              </p>
            ))}
          <ul className="flex flex-col gap-4">
            {members.data?.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p>{member.name}</p>
                  <p className="text-muted-foreground">{member.email}</p>
                </div>
                {member.role === "owner" ? (
                  <Badge variant="secondary">Owner</Badge>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <MemberRolePicker
                      label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={setRoleMutation.isPending}
                      onChange={(next) =>
                        setRoleMutation.mutate({
                          workspaceId,
                          targetUserId: member.userId,
                          role: next,
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      aria-label={`Transfer ownership to ${member.email}`}
                      disabled={transfer.isPending}
                      onClick={() => transfer.mutate({ workspaceId, targetUserId: member.userId })}
                    >
                      Transfer ownership
                    </Button>
                    <Button
                      variant="destructive"
                      aria-label={`Remove ${member.email}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ workspaceId, targetUserId: member.userId })}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invitations</h2>
          </CardTitle>
          <CardDescription>
            Create a link for one email address. Links expire in seven days.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const email = invitationEmailSchema.safeParse(
                new FormData(event.currentTarget).get("email"),
              );
              if (email.success) issue.mutate({ workspaceId, email: email.data, role });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Invite email</FieldLabel>
                <Input id="invite-email" name="email" type="email" required />
              </Field>
              <Field>
                <FieldLabel>Invitation role</FieldLabel>
                <MemberRolePicker label="Invitation role" value={role} onChange={setRole} />
              </Field>
              {issue.isError ? <p role="alert">{issue.error.message}</p> : null}
              <Button type="submit" disabled={issue.isPending}>
                Create invitation
              </Button>
            </FieldGroup>
          </form>
          {link ? (
            <Field>
              <FieldLabel htmlFor="invitation-link">Invitation link</FieldLabel>
              <Input id="invitation-link" value={link} readOnly />
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                    setCopyFailed(false);
                  } catch {
                    setCopyFailed(true);
                  }
                }}
              >
                {copied ? "Copied" : "Copy invitation link"}
              </Button>
              {copyFailed ? (
                <p role="status">Unable to copy automatically. Select and copy the link above.</p>
              ) : null}
            </Field>
          ) : null}
          {invitations.isError ? <p role="alert">{invitations.error.message}</p> : null}
          {revoke.isError ? <p role="alert">{revoke.error.message}</p> : null}
          <ul className="flex flex-col gap-3">
            {invitations.data?.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p>{invitation.email}</p>
                  <p className="text-muted-foreground">
                    {invitation.role} · Expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`Revoke invitation for ${invitation.email}`}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ workspaceId, invitationId: invitation.id })}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
