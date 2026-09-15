"use client";

import { memberRole } from "@kousa/projects/contracts";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";

export function RolePicker({
	value,
	onChange,
	label,
	disabled = false,
}: {
	value: "editor" | "viewer";
	onChange: (value: "editor" | "viewer") => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<ToggleGroup
			aria-label={label}
			variant="outline"
			value={[value]}
			disabled={disabled}
			onValueChange={(values) => {
				const selected = memberRole.safeParse(values[0]);
				if (selected.success) onChange(selected.data);
			}}
		>
			<ToggleGroupItem value="viewer">Viewer</ToggleGroupItem>
			<ToggleGroupItem value="editor">Editor</ToggleGroupItem>
		</ToggleGroup>
	);
}
