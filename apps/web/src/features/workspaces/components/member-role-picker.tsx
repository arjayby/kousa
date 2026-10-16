import { memberRoleSchema } from "@kousa/api/modules/workspaces/contract";
import { ToggleGroup, ToggleGroupItem } from "@kousa/ui/components/toggle-group";
import type { z } from "zod";

export function MemberRolePicker({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: z.infer<typeof memberRoleSchema>;
  onChange: (role: z.infer<typeof memberRoleSchema>) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      disabled={disabled}
      onValueChange={(values) => {
        const parsed = memberRoleSchema.safeParse(values[0]);
        if (parsed.success) onChange(parsed.data);
      }}
      variant="outline"
    >
      <ToggleGroupItem value="viewer">Viewer</ToggleGroupItem>
      <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
    </ToggleGroup>
  );
}
