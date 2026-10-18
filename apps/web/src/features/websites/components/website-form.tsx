import {
  hostnameInputSchema,
  websiteFieldsSchema,
  type Website,
} from "@kousa/api/modules/websites/contract";
import { Button } from "@kousa/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { useState } from "react";
import type { z } from "zod";

export function WebsiteForm({
  initialValues,
  onSave,
  pending,
  error,
  submitLabel,
}: {
  initialValues: Pick<Website, "name" | "hostname"> | null;
  onSave: (values: z.infer<typeof websiteFieldsSchema>) => void;
  pending: boolean;
  error: Error | null;
  submitLabel: string;
}) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [hostname, setHostname] = useState<string>(initialValues?.hostname ?? "");
  const [issues, setIssues] = useState<z.core.$ZodIssue[]>([]);
  const nameIssues = issues.filter((issue) => issue.path[0] === "name");
  const hostnameIssues = issues.filter((issue) => issue.path[0] === "hostname");
  const normalized = hostnameInputSchema.safeParse(hostname);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const parsed = websiteFieldsSchema.safeParse({ name, hostname });
        setIssues(parsed.success ? [] : parsed.error.issues);
        if (parsed.success) onSave(parsed.data);
      }}
    >
      <FieldGroup>
        <Field data-invalid={nameIssues.length > 0} data-disabled={pending}>
          <FieldLabel htmlFor="website-name">Website name</FieldLabel>
          <Input
            id="website-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            disabled={pending}
            aria-invalid={nameIssues.length > 0}
            aria-describedby={nameIssues.length ? "website-name-error" : undefined}
          />
          {nameIssues.length ? <FieldError id="website-name-error" errors={nameIssues} /> : null}
        </Field>
        <Field data-invalid={hostnameIssues.length > 0} data-disabled={pending}>
          <FieldLabel htmlFor="website-hostname">Website hostname</FieldLabel>
          <Input
            id="website-hostname"
            name="hostname"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            required
            maxLength={2048}
            disabled={pending}
            aria-invalid={hostnameIssues.length > 0}
            aria-describedby="hostname-help hostname-error"
            autoCapitalize="none"
            spellCheck={false}
          />
          <FieldDescription id="hostname-help">
            Enter a hostname or HTTP/HTTPS URL. Paths and ports are ignored. Apex, www, and other
            subdomains are separate websites.
          </FieldDescription>
          {normalized.success ? (
            <FieldDescription>Will save as: {normalized.data}</FieldDescription>
          ) : null}
          <FieldError id="hostname-error" errors={hostnameIssues} />
        </Field>
        {error ? <p role="alert">{error.message}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
