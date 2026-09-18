"use client";
import { Field, FieldLabel } from "@kousa/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kousa/ui/components/select";
export function OptionField({
	id,
	label,
	value,
	items,
	onChange,
	disabled,
}: {
	id: string;
	label: string;
	value: string;
	items: readonly { value: string; label: string }[];
	onChange: (value: string) => void;
	disabled?: boolean;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={items}
				value={value}
				onValueChange={(v) => {
					if (v) onChange(v);
				}}
				disabled={disabled}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}
