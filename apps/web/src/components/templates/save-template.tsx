"use client";

import { Button } from "@kousa/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { client } from "@/utils/orpc";
import { TemplateNameDialog } from "./template-name-dialog";

export function SaveTemplate({
	userId,
	projectId,
	canvasId,
	ready,
	hasNodes,
}: {
	userId: string;
	projectId: string;
	canvasId: string;
	ready: boolean;
	hasNodes: boolean;
}) {
	const [open, setOpen] = useState(false);
	const cache = useQueryClient();
	return (
		<>
			<Button
				variant="ghost"
				disabled={!ready || !hasNodes}
				onClick={() => setOpen(true)}
				title={
					!hasNodes
						? "Add nodes before saving a template"
						: !ready
							? "Wait for the canvas to finish saving"
							: "Save this workflow to your private templates"
				}
			>
				<BookmarkPlusIcon data-icon="inline-start" />
				Save template
			</Button>
			{open ? (
				<TemplateNameDialog
					title="Save workflow template"
					description="Save prompts, models, settings, and connections to your private library. Media files and generated results are excluded. Manage templates from the dashboard."
					submitLabel="Save template"
					canSubmit={ready && hasNodes}
					onClose={() => setOpen(false)}
					onSave={async (name, id) => {
						await client.templates.save({ id, projectId, canvasId, name });
						void cache.invalidateQueries({ queryKey: ["templates", userId] });
						toast.success("Template saved to your private library");
					}}
				/>
			) : null}
		</>
	);
}
