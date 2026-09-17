"use client";

import { templateName } from "@kousa/projects/template-contracts";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { type FormEvent, useId, useRef, useState } from "react";

// Mount a fresh dialog for each action. Retries retain their request ID and name.
export function TemplateNameDialog({
	title,
	description,
	label = "Template name",
	initialName = "",
	submitLabel,
	canSubmit = true,
	onClose,
	onSave,
}: {
	title: string;
	description: string;
	label?: string;
	initialName?: string;
	submitLabel: string;
	canSubmit?: boolean;
	onClose: () => void;
	onSave: (name: string, requestId: string) => Promise<void>;
}) {
	const fieldId = useId();
	const [name, setName] = useState(initialName);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState(false);
	const request = useRef<{ id: string; name: string } | null>(null);
	const busy = useRef(false);
	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy.current || !canSubmit) return;
		const parsed = templateName.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Enter a name.");
			return;
		}
		const input = request.current ?? {
			id: crypto.randomUUID(),
			name: parsed.data,
		};
		request.current = input;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await onSave(input.name, input.id);
			onClose();
		} catch (cause) {
			const code =
				cause && typeof cause === "object" && "code" in cause
					? String(cause.code)
					: "";
			const unconfirmed = ![
				"BAD_REQUEST",
				"FORBIDDEN",
				"NOT_FOUND",
				"CONFLICT",
				"UNAUTHORIZED",
				"SERVICE_UNAVAILABLE",
			].includes(code);
			setUncertain(unconfirmed);
			if (!unconfirmed) request.current = null;
			setError(
				cause instanceof Error
					? cause.message
					: "Could not confirm this request. Try again.",
			);
		} finally {
			busy.current = false;
			setPending(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="flex flex-col gap-4">
					<FieldGroup>
						<Field data-invalid={!!error} data-disabled={pending || uncertain}>
							<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
							<Input
								id={fieldId}
								value={name}
								onChange={(event) => {
									setName(event.target.value);
									request.current = null;
								}}
								maxLength={120}
								required
								disabled={pending || uncertain}
								aria-invalid={!!error}
								aria-describedby={error ? `${fieldId}-error` : undefined}
							/>
							{error ? (
								<FieldError id={`${fieldId}-error`}>{error}</FieldError>
							) : null}
						</Field>
					</FieldGroup>
					{uncertain ? (
						<p role="status">
							Retry to check the same request. Your name is kept to avoid
							creating a duplicate.
						</p>
					) : null}
					{!canSubmit ? (
						<p role="status">
							Wait for the canvas to connect and finish saving.
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={pending || !canSubmit}>
							{pending ? "Saving…" : uncertain ? "Retry request" : submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
