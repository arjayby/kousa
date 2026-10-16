import { workspaceNameSchema } from "@kousa/api/modules/workspaces/contract";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@kousa/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

function SubscriptionControls() {
  const customer = useQuery({
    queryKey: ["account", "subscription"],
    queryFn: async () => {
      const response = await authClient.customer.state();
      if (response.error) throw new Error(response.error.message);
      return response.data;
    },
  });
  const subscribed = (customer.data?.activeSubscriptions?.length ?? 0) > 0;
  return (
    <section className="flex items-center gap-3" aria-label="Your subscription">
      <p>Plan: {subscribed ? "Pro" : "Free"}</p>
      <Button
        disabled={customer.isPending}
        onClick={() =>
          subscribed ? authClient.customer.portal() : authClient.checkout({ slug: "pro" })
        }
      >
        {subscribed ? "Manage Subscription" : "Upgrade to Pro"}
      </Button>
    </section>
  );
}

export function WorkspacesHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaces = useQuery(orpc.workspaces.list.queryOptions({ meta: { workspaceList: true } }));
  const account = useQuery(orpc.privateData.queryOptions());
  const create = useMutation({
    ...orpc.workspaces.create.mutationOptions(),
    meta: { workspaceResult: true },
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: orpc.workspaces.list.key() });
      await navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: workspace.id } });
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <p className="text-muted-foreground">Choose a workspace or create one for your team.</p>
      </header>
      {workspaces.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load workspaces</AlertTitle>
          <AlertDescription>{workspaces.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {workspaces.data?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No workspaces yet</EmptyTitle>
            <EmptyDescription>
              Create a workspace below, or open an invitation link from its Owner.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <nav aria-label="Your workspaces" className="flex flex-col gap-2">
        {workspaces.data?.map((workspace) => (
          <Link
            key={workspace.id}
            to="/workspaces/$workspaceId"
            params={{ workspaceId: workspace.id }}
            className="flex items-center justify-between gap-3 border p-4"
          >
            <span>{workspace.name}</span>
            <Badge variant="secondary">{workspace.role}</Badge>
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Create a workspace</h2>
          </CardTitle>
          <CardDescription>
            You become its Owner. You can invite your team afterward.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = workspaceNameSchema.safeParse(
                new FormData(event.currentTarget).get("name"),
              );
              if (parsed.success) create.mutate({ name: parsed.data });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
                <Input id="workspace-name" name="name" required maxLength={100} />
              </Field>
              {create.isError ? <p role="alert">{create.error.message}</p> : null}
              <Button type="submit" disabled={create.isPending}>
                Create workspace
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {account.data?.billingEnabled ? <SubscriptionControls /> : null}
    </main>
  );
}
