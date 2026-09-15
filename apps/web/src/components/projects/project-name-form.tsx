"use client";

import { projectName } from "@kousa/projects/contracts";
import { Button } from "@kousa/ui/components/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { type FormEvent, useId, useState } from "react";

export function ProjectNameForm({
	initialName = "",
	submitLabel,
	onSave,
}: {
	initialName?: string;
	submitLabel: string;
	onSave: (name: string) => Promise<void>;
}) {
	const id = useId();
	const [name, setName] = useState(initialName);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	async function submit(event: FormEvent) {
		event.preventDefault();
		const parsed = projectName.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Enter a project name.");
			return;
		}
		setPending(true);
		setError(null);
		setSaved(false);
		try {
			await onSave(parsed.data);
			setSaved(true);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Could not save the project. Please try again.",
			);
		} finally {
			setPending(false);
		}
	}
	return (
		<form onSubmit={submit}>
			<FieldGroup>
				<Field data-invalid={Boolean(error)} data-disabled={pending}>
					<FieldLabel htmlFor={id}>Project name</FieldLabel>
					<Input
						id={id}
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							setSaved(false);
						}}
						placeholder="Untitled project"
						maxLength={120}
						required
						disabled={pending}
						aria-invalid={Boolean(error)}
						aria-describedby={error ? `${id}-error` : undefined}
					/>
					{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
				</Field>
				<Field orientation="horizontal">
					<Button type="submit" disabled={pending}>
						{pending ? "Saving…" : submitLabel}
					</Button>
					{saved && (
						<p role="status" className="text-muted-foreground text-sm">
							Saved.
						</p>
					)}
				</Field>
			</FieldGroup>
		</form>
	);
}
