"use client";

import { type ModelKind, modelsFor } from "@kousa/generation/model-catalog";
import { Button } from "@kousa/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kousa/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kousa/ui/components/dialog";
import { ChevronsUpDownIcon } from "lucide-react";
import { useRef, useState } from "react";

function filterModels(value: string, search: string, keywords: string[] = []) {
	const terms = search.toLowerCase().trim().split(/\s+/);
	const text = [value, ...keywords].join(" ").toLowerCase();
	return terms.every((term) => text.includes(term)) ? 1 : 0;
}

const groupsByKind = Object.fromEntries(
	(["text", "image", "video", "speech"] as const).map((kind) => {
		const models = modelsFor(kind);
		return [
			kind,
			[...new Set(models.map((model) => model.providerName))]
				.sort()
				.map((provider) => ({
					provider,
					models: models
						.filter((model) => model.providerName === provider)
						.sort(
							(a, b) =>
								Number(Boolean(a.unavailableReason)) -
									Number(Boolean(b.unavailableReason)) ||
								a.name.localeCompare(b.name),
						),
				})),
		];
	}),
);

export function ModelPicker({
	id,
	kind,
	value,
	onChange,
	disabled,
}: {
	id: string;
	kind: ModelKind;
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const models = modelsFor(kind);
	const selected = models.find((model) => model.id === value);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				id={id}
				ref={trigger}
				render={<Button variant="outline" disabled={disabled} />}
				className="w-full min-w-0 justify-between"
			>
				<span className="truncate">{selected?.name ?? "Choose a model"}</span>
				<ChevronsUpDownIcon data-icon="inline-end" />
			</DialogTrigger>
			<DialogContent
				className="sm:max-w-lg"
				initialFocus={input}
				finalFocus={trigger}
			>
				<DialogHeader>
					<DialogTitle>
						Choose {kind === "image" ? "an" : "a"} {kind} model
					</DialogTitle>
					<DialogDescription>
						{models.filter((model) => !model.unavailableReason).length}{" "}
						available models. Search by name or provider.
					</DialogDescription>
				</DialogHeader>
				<Command loop defaultValue={value} filter={filterModels}>
					<CommandInput
						ref={input}
						placeholder="Search models or providers..."
					/>
					<CommandList label="Models" className="max-h-[min(24rem,50dvh)]">
						<CommandEmpty>No matching models.</CommandEmpty>
						{groupsByKind[kind].map(({ provider, models }) => (
							<CommandGroup key={provider} heading={provider}>
								{models.map((model) => (
									<CommandItem
										key={model.id}
										value={model.id}
										keywords={[model.name, provider]}
										disabled={Boolean(model.unavailableReason)}
										data-checked={model.id === value}
										onSelect={() => {
											if (disabled || model.unavailableReason) return;
											onChange(model.id);
											setOpen(false);
										}}
									>
										<span className="flex min-w-0 flex-col gap-1">
											<span>
												{model.name}
												{model.unavailableReason ? " · Unavailable" : ""}
											</span>
											{model.unavailableReason ? (
												<span className="text-muted-foreground">
													{model.unavailableReason}
												</span>
											) : null}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
