"use client";

import { type ModelKind, modelsFor } from "@kousa/generation/model-catalog";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@kousa/ui/components/select";

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
	const models = modelsFor(kind);
	const groups = [...new Set(models.map((model) => model.providerName))].sort();
	return (
		<Select
			items={models.map((model) => ({ value: model.id, label: model.name }))}
			value={value}
			disabled={disabled}
			onValueChange={(value) => {
				if (value) onChange(value);
			}}
		>
			<SelectTrigger id={id} className="w-full min-w-0">
				<SelectValue />
			</SelectTrigger>
			<SelectContent
				alignItemWithTrigger={false}
				className="max-h-80 min-w-72 max-w-[90vw]"
			>
				{groups.map((provider) => (
					<SelectGroup key={provider}>
						<SelectLabel>{provider}</SelectLabel>
						{models
							.filter((model) => model.providerName === provider)
							.map((model) => (
								<SelectItem
									key={model.id}
									value={model.id}
									disabled={Boolean(model.unavailableReason)}
									title={model.unavailableReason}
								>
									<span className="flex flex-col whitespace-normal">
										<span>
											{model.name}
											{model.unavailableReason ? " · Unavailable" : ""}
										</span>
										{model.unavailableReason ? (
											<span className="text-muted-foreground text-xs">
												{model.unavailableReason}
											</span>
										) : null}
									</span>
								</SelectItem>
							))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}
