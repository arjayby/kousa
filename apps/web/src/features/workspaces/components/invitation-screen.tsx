import type { invitationTokenSchema } from "@kousa/api/modules/workspaces/contract";
import { Alert, AlertDescription, AlertTitle } from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export function InvitationScreen({ token }: { token: z.infer<typeof invitationTokenSchema> }) {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const verification = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Sign in to continue");
      const result = await authClient.sendVerificationEmail({
        email: session.user.email,
        callbackURL: `${window.location.origin}/invite/${token}`,
      });
      if (result.error) throw new Error(result.error.message);
    },
  });
  const accept = useMutation({
    ...orpc.workspaces.acceptInvitation.mutationOptions(),
    meta: { workspaceResult: true },
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: orpc.workspaces.list.key() });
      await navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: workspace.id } });
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Join workspace</h1>
      <p>
        You are signed in as {session?.user.email}. This must match the invitation's email address.
      </p>
      {session && !session.user.emailVerified ? (
        <Alert>
          <AlertTitle>Verify your email</AlertTitle>
          <AlertDescription>
            Verify your email address before accepting this invitation.
          </AlertDescription>
        </Alert>
      ) : null}
      {session && !session.user.emailVerified ? (
        <Button disabled={verification.isPending} onClick={() => verification.mutate()}>
          Send verification email
        </Button>
      ) : null}
      {verification.isSuccess ? (
        <p role="status">Verification email sent. Open the link in your inbox to continue.</p>
      ) : null}
      {verification.isError ? <p role="alert">{verification.error.message}</p> : null}
      {accept.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to join workspace</AlertTitle>
          <AlertDescription>{accept.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        disabled={!session?.user.emailVerified || accept.isPending}
        onClick={() => accept.mutate({ token })}
      >
        Accept invitation
      </Button>
      <Link to="/dashboard">All workspaces</Link>
    </main>
  );
}
