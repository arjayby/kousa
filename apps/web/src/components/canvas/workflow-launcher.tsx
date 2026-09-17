"use client";

import { graphOutputIds } from "@kousa/generation/graph-plan";
import { Button } from "@kousa/ui/components/button";
import { Checkbox } from "@kousa/ui/components/checkbox";
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
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@kousa/ui/components/field";
import { LoaderCircleIcon, WorkflowIcon } from "lucide-react";
import { useId, useState } from "react";
import type { Workflow } from "./canvas-workflow";
import { documentFromGraph, type StudioGraph } from "./use-canvas";

export function WorkflowLauncher({
	workflow,
	graph,
	canEdit,
}: {
	workflow: Workflow;
	graph: StudioGraph;
	canEdit: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [chosen, setChosen] = useState<string[]>([]);
	const id = useId();
	const outputs = graphOutputIds(documentFromGraph(graph));
	const selected = graph.nodes
		.filter((node) => node.selected)
		.map((node) => node.id);
	// Collaborators can remove nodes while the chooser is open.
	const targets = chosen.filter((nodeId) =>
		graph.nodes.some((node) => node.id === nodeId),
	);
	const disabled =
		!workflow.canRun ||
		!workflow.configured ||
		workflow.loading ||
		workflow.queryError ||
		workflow.pending ||
		!!workflow.active ||
		workflow.uncertain;
	if (!canEdit) return null;
	return (
		<>
			<Button
				size="sm"
				disabled={disabled || !graph.nodes.length}
				onClick={() => {
					setChosen(outputs);
					setOpen(true);
				}}
			>
				<WorkflowIcon data-icon="inline-start" />
				Run workflow
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!workflow.pending) setOpen(next);
				}}
			>
				<DialogContent
					className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
					showCloseButton={!workflow.pending}
				>
					<DialogHeader>
						<DialogTitle>Choose workflow outputs</DialogTitle>
						<DialogDescription>
							Select the results you want. Their connected inputs will run
							automatically, with shared steps generated once.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={workflow.pending || !outputs.length}
							onClick={() => setChosen(outputs)}
						>
							All outputs
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={workflow.pending || !selected.length}
							onClick={() => setChosen(selected)}
						>
							Use canvas selection
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={workflow.pending || !targets.length}
							onClick={() => setChosen([])}
						>
							Clear
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">
						All outputs selects nodes with no outgoing connections. You can also
						choose any intermediate node.
					</p>
					<FieldSet disabled={workflow.pending}>
						<FieldLegend variant="label">
							Outputs ({targets.length} selected)
						</FieldLegend>
						<FieldGroup className="max-h-64 overflow-y-auto py-1">
							{graph.nodes.map((node) => (
								<Field key={node.id} orientation="horizontal">
									<Checkbox
										id={`${id}-${node.id}`}
										checked={targets.includes(node.id)}
										onCheckedChange={(checked) =>
											setChosen((current) =>
												checked
													? [...current, node.id]
													: current.filter((value) => value !== node.id),
											)
										}
									/>
									<FieldLabel
										htmlFor={`${id}-${node.id}`}
										className="min-w-0 break-words"
									>
										{node.data.label || node.type}
										<span className="shrink-0 text-muted-foreground text-xs">
											{node.type}
										</span>
									</FieldLabel>
								</Field>
							))}
						</FieldGroup>
					</FieldSet>
					<p className="text-muted-foreground text-xs">
						Up to 20 steps total, including connected inputs. Review the
						combined credits before starting.
					</p>
					{targets.length > 20 ? (
						<p role="alert" className="text-destructive text-sm">
							Choose at most 20 outputs.
						</p>
					) : null}
					{workflow.error ? (
						<p role="alert" className="text-destructive text-sm">
							{workflow.error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							variant="outline"
							disabled={workflow.pending}
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button
							disabled={disabled || !targets.length || targets.length > 20}
							onClick={async () => {
								if (await workflow.review(targets)) setOpen(false);
							}}
						>
							{workflow.pending ? (
								<LoaderCircleIcon
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : null}
							Review outputs
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
