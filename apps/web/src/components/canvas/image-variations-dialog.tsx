"use client";

import { defaultImageModel, imageModels } from "@kousa/generation/contracts";
import { planGraph } from "@kousa/generation/graph-plan";
import {
	createImageVariations,
	type ImageVariationsRequest,
	imageVariationSourceKey,
	imageVariationsError,
	maxImageVariations,
} from "@kousa/generation/image-variations";
import { imageProfile, modelCreditCost } from "@kousa/generation/model-catalog";
import { retainProjectMedia } from "@kousa/media/upload";
import {
	aspectRatios,
	type CanvasDocument,
	type CanvasNode,
} from "@kousa/projects/canvas";
import { Alert, AlertDescription } from "@kousa/ui/components/alert";
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
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@kousa/ui/components/field";
import { Textarea } from "@kousa/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import {
	CopyPlusIcon,
	LoaderCircleIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { AssetPreview, useCanvasMedia } from "./canvas-media";
import type { Workflow } from "./canvas-workflow";

export type InsertImageVariations = (
	request: ImageVariationsRequest,
	sourceKey: string,
) => string[];

export type ImageVariationSession = {
	source: CanvasNode;
	sourceKey: string;
	assetId: string | null;
};

export function ImageVariationsDialog({
	graph,
	initial,
	canEdit,
	workflow,
	insert,
	close,
}: {
	graph: CanvasDocument;
	initial: ImageVariationSession;
	canEdit: boolean;
	workflow: Workflow;
	insert: InsertImageVariations;
	close: () => void;
}) {
	const media = useCanvasMedia();
	const id = useId();
	const sourceId = initial.source.id;
	const [mode, setMode] = useState<ImageVariationsRequest["mode"]>(
		initial.assetId && !initial.source.data.content.trim() ? "image" : "inputs",
	);
	const [prompt, setPrompt] = useState(
		initial.source.data.content ||
			(initial.assetId
				? "Create a new variation of this image. Preserve the main subject and its details."
				: ""),
	);
	const [variations, setVariations] = useState(() =>
		Array.from({ length: 2 }, () => ({
			id: crypto.randomUUID(),
			instructions: "",
			aspectRatio: initial.source.data.aspectRatio,
		})),
	);
	const [created, setCreated] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const submitting = useRef(false);
	const latest = useRef({ canEdit, insert });
	latest.current = { canEdit, insert };
	const changed =
		imageVariationSourceKey(graph, sourceId) !== initial.sourceKey;
	const locked = !canEdit || busy;
	const request = {
		sourceId,
		mode,
		referenceAssetId: initial.assetId,
		prompt,
		variations: variations.map(({ instructions, aspectRatio }) => ({
			instructions,
			aspectRatio,
		})),
	};
	const validation = created ? null : imageVariationsError(graph, request);
	const remaining =
		created?.filter((nodeId) =>
			graph.nodes.some((node) => node.id === nodeId),
		) ?? [];
	const cannotReview =
		!workflow.canRun ||
		!workflow.configured ||
		workflow.loading ||
		workflow.queryError ||
		workflow.pending ||
		!!workflow.active ||
		workflow.uncertain ||
		remaining.length !== created?.length;
	function update(index: number, patch: Partial<(typeof variations)[number]>) {
		setVariations((current) =>
			current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
		);
		setError(null);
	}
	async function create() {
		if (submitting.current || !canEdit || changed || validation) return;
		submitting.current = true;
		setBusy(true);
		setError(null);
		try {
			// Use the execution planner before insertion to check the shared input limit,
			// model compatibility and effective prompt size without reserving credits.
			const preview = createImageVariations(graph, request);
			await planGraph(
				{
					version: 1,
					nodes: [...graph.nodes, ...preview.nodes],
					edges: [...graph.edges, ...preview.edges],
				},
				preview.targetIds,
			);
			if (mode === "image" && initial.assetId)
				await retainProjectMedia(media.projectId, initial.assetId);
			if (!latest.current.canEdit)
				throw new Error(
					"Editing access changed. Variations have not been created.",
				);
			setCreated(latest.current.insert(request, initial.sourceKey));
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not create variations.",
			);
		} finally {
			submitting.current = false;
			setBusy(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy && !workflow.pending) close();
			}}
		>
			<DialogContent
				className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
				showCloseButton={!busy && !workflow.pending}
			>
				<DialogHeader>
					<DialogTitle>
						{created
							? "Image variations created"
							: `Create variations · ${initial.source.data.label}`}
					</DialogTitle>
					<DialogDescription>
						{created
							? "Your variations are selected on the canvas. Review their combined cost before starting generation."
							: "Prepare 2–8 images together. Adjust each prompt and size, then review generation credits."}
					</DialogDescription>
				</DialogHeader>
				{created ? (
					<>
						<p>
							{created.length} editable image nodes added. Shared inputs are
							included once in the workflow.
						</p>
						{remaining.length !== created.length && workflow.canRun ? (
							<Alert variant="destructive">
								<AlertDescription>
									Some variation nodes were removed. Close this dialog and
									select the remaining outputs through Run affected steps.
								</AlertDescription>
							</Alert>
						) : null}
						{!workflow.canRun ? (
							<p role="status">
								Waiting for editing access and canvas sync before review.
							</p>
						) : null}
						{workflow.active ? (
							<p role="status">
								Wait for the active workflow to finish, or stop it in Runs.
							</p>
						) : null}
						{workflow.queryError ||
						(!workflow.configured && !workflow.loading) ? (
							<p role="alert">
								Generation is unavailable. Your variation nodes are saved;
								review them through Run affected steps when it is available.
							</p>
						) : null}
						{workflow.error ? (
							<Alert variant="destructive">
								<AlertDescription>{workflow.error}</AlertDescription>
							</Alert>
						) : null}
						<DialogFooter>
							<Button
								variant="outline"
								disabled={workflow.pending}
								onClick={close}
							>
								View variations
							</Button>
							<Button
								disabled={cannotReview || !canEdit}
								onClick={async () => {
									if (await workflow.review(created)) close();
								}}
							>
								{workflow.pending ? (
									<LoaderCircleIcon
										data-icon="inline-start"
										className="animate-spin"
									/>
								) : null}
								Review variations
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<FieldGroup>
							<Field>
								<FieldLabel>Starting point</FieldLabel>
								<ToggleGroup
									aria-label="Variation starting point"
									variant="outline"
									value={[mode]}
									disabled={locked}
									onValueChange={(values) => {
										const value = values[0];
										if (value === "inputs" || value === "image") {
											setMode(value);
											setError(null);
										}
									}}
								>
									<ToggleGroupItem value="inputs">Same inputs</ToggleGroupItem>
									<ToggleGroupItem value="image" disabled={!initial.assetId}>
										Current image
									</ToggleGroupItem>
								</ToggleGroup>
								<FieldDescription>
									{mode === "inputs"
										? "Shares the source node's prompt and reference connections. The original node and its outputs stay in place."
										: "Adds a fixed reference image shared by all variations. Later generations on the original node will not change it."}
								</FieldDescription>
							</Field>
							{mode === "image" && initial.assetId ? (
								<AssetPreview assetId={initial.assetId} />
							) : null}
							{mode === "inputs" ? (
								<p className="text-muted-foreground text-xs">
									Shared inputs:{" "}
									{graph.edges
										.filter((edge) => edge.target === sourceId)
										.map(
											(edge) =>
												graph.nodes.find((node) => node.id === edge.source)
													?.data.label,
										)
										.filter(Boolean)
										.join(", ") || "None"}
								</p>
							) : null}
							{initial.source.data.imageLayout ? (
								<p className="text-muted-foreground text-xs">
									To vary your text and logo composition, save it as an image to
									canvas first and select that image node.
								</p>
							) : null}
							<Field>
								<FieldLabel htmlFor={`${id}-prompt`}>Common prompt</FieldLabel>
								<Textarea
									id={`${id}-prompt`}
									maxLength={10_000}
									value={prompt}
									disabled={locked}
									onChange={(event) => {
										setPrompt(event.target.value);
										setError(null);
									}}
								/>
								<FieldDescription>
									Included in every variation, alongside any connected text.
								</FieldDescription>
							</Field>
							<p className="text-muted-foreground text-xs">
								Model:{" "}
								{imageModels.find(
									(model) => model.id === initial.source.data.imageModel,
								)?.name ?? imageModels[0]?.name}
							</p>
							{variations.map((variation, index) => (
								<FieldSet
									key={variation.id}
									disabled={locked}
									className="rounded-md border p-3"
								>
									<FieldLegend variant="label">
										Variation {index + 1}
									</FieldLegend>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor={`${id}-${variation.id}`}>
												Variation {index + 1} instructions
											</FieldLabel>
											<Textarea
												id={`${id}-${variation.id}`}
												placeholder="Optional: change the lighting, background, composition…"
												maxLength={2000}
												value={variation.instructions}
												onChange={(event) =>
													update(index, { instructions: event.target.value })
												}
											/>
										</Field>
										<Field>
											<FieldLabel>
												{imageProfile(
													initial.source.data.imageModel ?? defaultImageModel,
												).automaticSize
													? "Automatic dimensions"
													: "Aspect ratio"}
											</FieldLabel>
											<ToggleGroup
												aria-label={`Variation ${index + 1} aspect ratio`}
												variant="outline"
												value={[variation.aspectRatio]}
												onValueChange={(values) => {
													const value = values[0];
													if (aspectRatios.some((ratio) => ratio === value))
														update(index, {
															aspectRatio:
																value as typeof variation.aspectRatio,
														});
												}}
											>
												{imageProfile(
													initial.source.data.imageModel ?? defaultImageModel,
												).aspectRatios.map((ratio) => (
													<ToggleGroupItem key={ratio} value={ratio}>
														{ratio}
													</ToggleGroupItem>
												))}
											</ToggleGroup>
										</Field>
										<Button
											variant="ghost"
											size="sm"
											aria-label={`Remove variation ${index + 1}`}
											disabled={locked || variations.length <= 2}
											onClick={() =>
												setVariations((current) =>
													current.filter((item) => item.id !== variation.id),
												)
											}
										>
											<Trash2Icon data-icon="inline-start" />
											Remove
										</Button>
									</FieldGroup>
								</FieldSet>
							))}
							<Button
								variant="outline"
								disabled={locked || variations.length >= maxImageVariations}
								onClick={() =>
									setVariations((current) => [
										...current,
										{
											id: crypto.randomUUID(),
											instructions: "",
											aspectRatio: initial.source.data.aspectRatio,
										},
									])
								}
							>
								<PlusIcon data-icon="inline-start" />
								Add variation
							</Button>
						</FieldGroup>
						<p>
							{variations.length *
								modelCreditCost(
									"image",
									initial.source.data.imageModel ?? defaultImageModel,
									undefined,
									initial.source.data.imageQuality,
								)}{" "}
							credits for {variations.length} new images, plus any shared inputs
							that need generation. The next review shows the final total.
							Creating nodes costs no credits.
						</p>
						{changed ? (
							<Alert variant="destructive">
								<AlertDescription>
									The source or its inputs changed while this dialog was open.
									Reopen it to use the current settings.
								</AlertDescription>
							</Alert>
						) : null}
						{error || validation ? (
							<Alert variant="destructive">
								<AlertDescription>{error || validation}</AlertDescription>
							</Alert>
						) : null}
						<DialogFooter>
							<Button variant="outline" disabled={busy} onClick={close}>
								Cancel
							</Button>
							<Button
								disabled={locked || changed || !!validation}
								onClick={() => void create()}
							>
								{busy ? (
									<LoaderCircleIcon
										data-icon="inline-start"
										className="animate-spin"
									/>
								) : (
									<CopyPlusIcon data-icon="inline-start" />
								)}
								Create {variations.length} variations
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
