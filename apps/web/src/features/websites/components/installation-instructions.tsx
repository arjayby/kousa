import type { installationSchema } from "@kousa/api/modules/websites/contract";
import { Alert, AlertDescription, AlertTitle } from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kousa/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@kousa/ui/components/field";
import { Textarea } from "@kousa/ui/components/textarea";
import { useId, useState } from "react";
import type { z } from "zod";

function CopyText({
  label,
  value,
  buttonLabel,
  statusLabel,
  rows,
}: {
  label: string;
  value: string;
  buttonLabel: string;
  statusLabel: string;
  rows: number;
}) {
  const [state, setState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        readOnly
        rows={rows}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        variant="outline"
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {buttonLabel}
      </Button>
      <p role="status" aria-label={statusLabel}>
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Unable to copy. Select the text and copy it manually."
            : ""}
      </p>
    </Field>
  );
}

export function InstallationInstructions({
  installation,
}: {
  installation: z.infer<typeof installationSchema>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Installation instructions</h2>
        </CardTitle>
        <CardDescription>Prepare this snippet for the tracking SDK.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>Tracking SDK unavailable</AlertTitle>
          <AlertDescription>
            The SDK and event collector are not available yet. This snippet cannot track activity.
            Website setup is saved, but installation and tracking have not been verified.
          </AlertDescription>
        </Alert>
        {installation.kind === "unconfigured" ? (
          <Alert>
            <AlertTitle>Script URL not configured</AlertTitle>
            <AlertDescription>
              This is a placeholder template. Ask the operator to configure the tracking script URL
              before using it.
            </AlertDescription>
          </Alert>
        ) : null}
        <p>
          When the SDK is available, place this script once in each page&apos;s{" "}
          <code>&lt;head&gt;</code>, or in the shared layout that renders it. Do not add the script
          twice.
        </p>
        <p>
          The public tracking ID identifies this website. It is public and grants no access to
          settings or analytics.
        </p>
        <FieldGroup>
          <CopyText
            key={installation.publicTrackingId}
            label="Public tracking ID"
            value={installation.publicTrackingId}
            buttonLabel="Copy tracking ID"
            statusLabel="Tracking ID copy result"
            rows={1}
          />
          <CopyText
            key={installation.snippet}
            label="Installation snippet"
            value={installation.snippet}
            buttonLabel="Copy snippet"
            statusLabel="Snippet copy result"
            rows={3}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
