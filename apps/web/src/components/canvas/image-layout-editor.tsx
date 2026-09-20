"use client";

import { imageMimeTypes, type PublicAsset } from "@kousa/media/contracts";
import { retainProjectMedia, uploadProjectMedia } from "@kousa/media/upload";
import {
	clampLayoutRect,
	createImageLayout,
	createTextLayer,
	type ImageLayout,
	imageLayoutSchema,
	type LayoutLayer,
	type LayoutRect,
	layoutAssetIds,
	layoutPresets,
} from "@kousa/projects/image-layout";
import { Alert, AlertDescription } from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kousa/ui/components/select";
import { Textarea } from "@kousa/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	DownloadIcon,
	ImagePlusIcon,
	RedoIcon,
	SaveIcon,
	Trash2Icon,
	TypeIcon,
	UndoIcon,
} from "lucide-react";
import {
	type PointerEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useCanvasMedia } from "./canvas-media";
import type { ApplyHistory } from "./generation-history";
import {
	exportImageLayout,
	type LayoutImages,
	loadLayoutImages,
	renderImageLayout,
} from "./image-layout-renderer";
import type { StudioNode } from "./use-canvas";

function Choice({
	label,
	value,
	items,
	onChange,
	disabled,
}: {
	label: string;
	value: string;
	items: { value: string; label: string }[];
	onChange: (value: string) => void;
	disabled?: boolean;
}) {
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Select
				items={items}
				value={value}
				disabled={disabled}
				onValueChange={(value) => {
					if (value) onChange(value);
				}}
			>
				<SelectTrigger aria-label={label} className="w-full">
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
function NumberField({
	label,
	value,
	min,
	max,
	disabled,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	disabled: boolean;
	onChange: (value: number) => void;
}) {
	const id = useId();
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				aria-label={label}
				type="number"
				min={min}
				max={max}
				step={1}
				value={Math.round(value)}
				disabled={disabled}
				onChange={(event) => {
					const value = event.currentTarget.valueAsNumber;
					if (Number.isFinite(value))
						onChange(Math.max(min, Math.min(max, value)));
				}}
			/>
		</Field>
	);
}
export default function ImageLayoutEditor({
	node,
	assetId,
	canEdit,
	apply,
	addImage,
	close,
}: {
	node: StudioNode;
	assetId: string | null;
	canEdit: boolean;
	apply: ApplyHistory;
	addImage: (asset: PublicAsset) => boolean;
	close: () => void;
}) {
	const media = useCanvasMedia();
	const [history, setHistory] = useState(() => {
		const asset = media.assets.find((item) => item.id === assetId);
		return {
			past: [] as ImageLayout[],
			layout: structuredClone(
				node.data.imageLayout ??
					createImageLayout(
						assetId,
						asset?.width ?? 1080,
						asset?.height ?? 1080,
					),
			),
			future: [] as ImageLayout[],
		};
	});
	const { layout } = history;
	const [saved, setSaved] = useState(() =>
		JSON.stringify(node.data.imageLayout ?? history.layout),
	);
	const baseline = useRef(structuredClone(node));
	const latest = useRef({ canEdit, apply, addImage });
	latest.current = { canEdit, apply, addImage };
	const [selected, setSelected] = useState<string | null>(
		layout.layers[0]?.id ?? null,
	);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [discard, setDiscard] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const [loaded, setLoaded] = useState<{
		key: string;
		images: LayoutImages;
		error: string | null;
	} | null>(null);
	const [rendered, setRendered] = useState<{
		error: string | null;
		clipped: string[];
	}>({ error: null, clipped: [] });
	const canvas = useRef<HTMLCanvasElement>(null);
	const board = useRef<HTMLDivElement>(null);
	const drag = useRef<{
		id: string;
		x: number;
		y: number;
		rect: LayoutRect;
		resize: boolean;
	} | null>(null);
	const [moving, setMoving] = useState<{ id: string; rect: LayoutRect } | null>(
		null,
	);
	const key = layoutAssetIds(layout).sort().join("|");
	const ready = loaded?.key === key && !loaded.error;
	const dirty = JSON.stringify(layout) !== saved;
	const locked = !canEdit || busy;
	const layer = layout.layers.find((item) => item.id === selected);
	const display = useMemo(
		() =>
			moving
				? {
						...layout,
						layers: layout.layers.map((layer) =>
							layer.id === moving.id ? { ...layer, ...moving.rect } : layer,
						),
					}
				: layout,
		[layout, moving],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the same asset IDs.
	useEffect(() => {
		const controller = new AbortController();
		let images: LayoutImages | undefined;
		void loadLayoutImages(
			media.projectId,
			key ? key.split("|") : [],
			controller.signal,
		)
			.then((result) => {
				images = result;
				if (controller.signal.aborted) {
					for (const image of images.values()) image.close();
					return;
				}
				setLoaded({ key, images, error: null });
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					setLoaded({
						key,
						images: new Map(),
						error:
							error instanceof Error
								? error.message
								: "Could not load layout images.",
					});
			});
		return () => {
			controller.abort();
			if (images) for (const image of images.values()) image.close();
		};
	}, [key, media.projectId, retry]);
	useEffect(() => {
		if (!canvas.current || !ready || !loaded) return;
		try {
			setRendered({
				error: null,
				clipped: renderImageLayout(canvas.current, display, loaded.images),
			});
		} catch (error) {
			setRendered({
				error:
					error instanceof Error ? error.message : "Could not render layout.",
				clipped: [],
			});
		}
	}, [display, loaded, ready]);
	function edit(update: (current: ImageLayout) => ImageLayout) {
		if (locked) return;
		setError(null);
		setDiscard(false);
		setHistory((current) => {
			const next = imageLayoutSchema.parse(update(current.layout));
			if (JSON.stringify(next) === JSON.stringify(current.layout))
				return current;
			return {
				past: [...current.past.slice(-49), current.layout],
				layout: next,
				future: [],
			};
		});
	}
	function patchLayer(id: string, patch: Partial<LayoutLayer>) {
		edit((current) => ({
			...current,
			layers: current.layers.map((layer) =>
				layer.id === id ? ({ ...layer, ...patch } as LayoutLayer) : layer,
			),
		}));
	}
	function addLayer(layer: LayoutLayer) {
		edit((current) => ({ ...current, layers: [...current.layers, layer] }));
		setSelected(layer.id);
	}
	function moveLayer(direction: number) {
		edit((current) => {
			const layers = [...current.layers];
			const index = layers.findIndex((layer) => layer.id === selected);
			const other = index + direction;
			if (index < 0 || other < 0 || other >= layers.length) return current;
			const a = layers[index];
			const b = layers[other];
			if (a && b) {
				layers[index] = b;
				layers[other] = a;
			}
			return { ...current, layers };
		});
	}
	function startDrag(
		event: PointerEvent<HTMLButtonElement>,
		layer: LayoutLayer,
		resize = false,
	) {
		setSelected(layer.id);
		if (locked || event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.focus();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			id: layer.id,
			x: event.clientX,
			y: event.clientY,
			rect: layer,
			resize,
		};
	}
	function dragRect(event: PointerEvent<HTMLButtonElement>) {
		const initial = drag.current;
		const bounds = board.current?.getBoundingClientRect();
		if (!initial || !bounds) return null;
		const dx = (event.clientX - initial.x) / bounds.width;
		const dy = (event.clientY - initial.y) / bounds.height;
		const rect = initial.resize
			? {
					...initial.rect,
					width: Math.min(1 - initial.rect.x, initial.rect.width + dx),
					height: Math.min(1 - initial.rect.y, initial.rect.height + dy),
				}
			: { ...initial.rect, x: initial.rect.x + dx, y: initial.rect.y + dy };
		return { id: initial.id, rect: clampLayoutRect(rect) };
	}
	async function run(action: () => Promise<void>) {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Could not complete the operation.",
			);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	async function saveLayout() {
		if (!latest.current.canEdit)
			throw new Error(
				"Editing access changed. Your layout has not been saved.",
			);
		await Promise.all(
			layoutAssetIds(layout).map((id) =>
				retainProjectMedia(media.projectId, id),
			),
		);
		if (
			!latest.current.canEdit ||
			!latest.current.apply(baseline.current, { imageLayout: layout })
		)
			throw new Error(
				"This node changed while the layout was open. Download your draft, then reopen the editor to load the saved version.",
			);
		baseline.current = {
			...baseline.current,
			data: { ...baseline.current.data, imageLayout: layout },
		};
		setSaved(JSON.stringify(layout));
	}
	async function download(format: "png" | "jpeg") {
		if (!ready || !loaded) throw new Error("Wait for the images to load.");
		const blob = await exportImageLayout(layout, loaded.images, format);
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${node.data.label || "image"}-layout.${format === "jpeg" ? "jpg" : "png"}`;
		link.hidden = true;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}
	const images = media.assets.filter((asset) =>
		imageMimeTypes.some((type) => type === asset.mimeType),
	);
	const assetItems = [
		{ value: "none", label: "No image" },
		...images.map((asset) => ({ value: asset.id, label: asset.name })),
	];
	const exportDisabled =
		busy || !ready || !!rendered.error || rendered.clipped.length > 0;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (open || busyRef.current) return;
				if (dirty) setDiscard(true);
				else close();
			}}
		>
			<DialogContent className="flex max-h-[94dvh] flex-col sm:max-w-6xl">
				<DialogHeader>
					<DialogTitle>Text, logo & export · {node.data.label}</DialogTitle>
					<DialogDescription>
						Save the layout to keep its layers editable. Save an image to canvas
						to use the finished design in another workflow.
					</DialogDescription>
				</DialogHeader>
				<div
					className="flex flex-wrap gap-2"
					role="toolbar"
					aria-label="Layout tools"
				>
					<Button
						variant="outline"
						disabled={locked || layout.layers.length >= 20}
						onClick={() => addLayer(createTextLayer())}
					>
						<TypeIcon data-icon="inline-start" />
						Add text
					</Button>
					<Button
						variant="outline"
						disabled={locked || layout.layers.length >= 20}
						onClick={() =>
							addLayer({
								id: crypto.randomUUID(),
								kind: "logo",
								assetId: null,
								x: 0.72,
								y: 0.76,
								width: 0.2,
								height: 0.16,
								opacity: 1,
							})
						}
					>
						<ImagePlusIcon data-icon="inline-start" />
						Add logo
					</Button>
					<Button
						variant="outline"
						size="icon"
						aria-label="Undo layout edit"
						disabled={locked || !history.past.length}
						onClick={() =>
							setHistory((current) => {
								const previous = current.past.at(-1);
								return previous
									? {
											past: current.past.slice(0, -1),
											layout: previous,
											future: [current.layout, ...current.future],
										}
									: current;
							})
						}
					>
						<UndoIcon />
					</Button>
					<Button
						variant="outline"
						size="icon"
						aria-label="Redo layout edit"
						disabled={locked || !history.future.length}
						onClick={() =>
							setHistory((current) => {
								const next = current.future[0];
								return next
									? {
											past: [...current.past, current.layout],
											layout: next,
											future: current.future.slice(1),
										}
									: current;
							})
						}
					>
						<RedoIcon />
					</Button>
					<span className="self-center text-muted-foreground">
						{layout.width} × {layout.height} · {layout.layers.length}/20 layers
						{dirty ? " · Unsaved changes" : ""}
					</span>
				</div>
				<div className="grid min-h-0 gap-5 overflow-y-auto sm:grid-cols-[minmax(0,1fr)_240px] lg:grid-cols-[minmax(0,1fr)_300px]">
					<section
						aria-label="Layout preview"
						className="flex min-w-0 flex-col items-center gap-3 self-start rounded-md bg-muted/30 p-4 sm:sticky sm:top-0"
					>
						<div
							ref={board}
							className="relative shrink-0 shadow-sm"
							style={{
								width: `min(100%, ${Math.round((480 * layout.width) / layout.height)}px)`,
								aspectRatio: `${layout.width}/${layout.height}`,
							}}
						>
							<canvas
								ref={canvas}
								aria-label="Export preview"
								className="block w-full"
								style={{ aspectRatio: `${layout.width}/${layout.height}` }}
							/>
							{display.layers.map((layer) => (
								<div
									key={layer.id}
									className={
										layer.id === selected
											? "absolute border-2 border-primary"
											: "absolute border border-transparent hover:border-primary/50"
									}
									style={{
										left: `${layer.x * 100}%`,
										top: `${layer.y * 100}%`,
										width: `${layer.width * 100}%`,
										height: `${layer.height * 100}%`,
									}}
								>
									<button
										type="button"
										aria-label={`Select ${layer.kind === "text" ? layer.text.slice(0, 40) || "empty text" : "logo"} layer`}
										aria-pressed={selected === layer.id}
										className="absolute inset-0 cursor-move touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
										onClick={() => setSelected(layer.id)}
										onPointerDown={(event) => startDrag(event, layer)}
										onPointerMove={(event) => {
											const next = dragRect(event);
											if (next) setMoving(next);
										}}
										onPointerUp={(event) => {
											const next = dragRect(event);
											drag.current = null;
											setMoving(null);
											if (next) patchLayer(next.id, next.rect);
										}}
										onPointerCancel={() => {
											drag.current = null;
											setMoving(null);
										}}
										onKeyDown={(event) => {
											if (locked) return;
											const amount = event.shiftKey ? 10 : 1;
											const directions: Record<string, [number, number]> = {
												ArrowLeft: [-amount / layout.width, 0],
												ArrowRight: [amount / layout.width, 0],
												ArrowUp: [0, -amount / layout.height],
												ArrowDown: [0, amount / layout.height],
											};
											const direction = directions[event.key];
											if (direction) {
												event.preventDefault();
												patchLayer(
													layer.id,
													clampLayoutRect({
														...layer,
														x: layer.x + direction[0],
														y: layer.y + direction[1],
													}),
												);
											}
										}}
									/>
									{layer.id === selected && !locked ? (
										<button
											type="button"
											aria-label="Resize selected layer"
											className="absolute -right-2 -bottom-2 size-4 cursor-se-resize touch-none border border-background bg-primary"
											onPointerDown={(event) => startDrag(event, layer, true)}
											onPointerMove={(event) => {
												const next = dragRect(event);
												if (next) setMoving(next);
											}}
											onPointerUp={(event) => {
												const next = dragRect(event);
												drag.current = null;
												setMoving(null);
												if (next) patchLayer(next.id, next.rect);
											}}
											onPointerCancel={() => {
												drag.current = null;
												setMoving(null);
											}}
										/>
									) : null}
								</div>
							))}
						</div>
						<p className="text-muted-foreground text-xs">
							Drag a layer or its corner handle. Arrow keys move 1 pixel; Shift
							+ arrow moves 10. Use the fields for exact placement.
						</p>
						{!ready ? (
							<p role="status">
								{loaded?.key === key && loaded.error
									? loaded.error
									: "Loading images…"}
							</p>
						) : null}
						{loaded?.error ? (
							<Button
								variant="outline"
								onClick={() => setRetry((value) => value + 1)}
							>
								Retry images
							</Button>
						) : null}
						{rendered.error ? (
							<p role="alert" className="text-destructive">
								{rendered.error}
							</p>
						) : null}
						{rendered.clipped.length ? (
							<p role="alert" className="text-destructive">
								Text is clipped in {rendered.clipped.length} layer(s). Enlarge
								the text box or reduce the font size to export.
							</p>
						) : null}
					</section>
					<div className="flex flex-col gap-5">
						<FieldGroup>
							<Choice
								label="Artboard size"
								value={`${layout.width}x${layout.height}`}
								items={[
									...layoutPresets.map((p) => ({
										value: `${p.width}x${p.height}`,
										label: p.label,
									})),
									...(!layoutPresets.some(
										(p) =>
											p.width === layout.width && p.height === layout.height,
									)
										? [
												{
													value: `${layout.width}x${layout.height}`,
													label: `Original · ${layout.width} × ${layout.height}`,
												},
											]
										: []),
								]}
								disabled={locked}
								onChange={(value) => {
									const [width, height] = value.split("x").map(Number);
									if (width && height)
										edit((current) => ({ ...current, width, height }));
								}}
							/>
							<Choice
								label="Background image"
								value={layout.backgroundAssetId ?? "none"}
								items={assetItems}
								disabled={locked || media.pending}
								onChange={(value) =>
									edit((current) => ({
										...current,
										backgroundAssetId: value === "none" ? null : value,
									}))
								}
							/>
							<Choice
								label="Image fit"
								value={layout.fit}
								items={[
									{ value: "contain", label: "Fit entire image" },
									{ value: "cover", label: "Fill and crop" },
								]}
								disabled={locked}
								onChange={(value) =>
									edit((current) => ({
										...current,
										fit: value as ImageLayout["fit"],
									}))
								}
							/>
							<Field>
								<FieldLabel htmlFor="layout-background">
									Artboard color
								</FieldLabel>
								<Input
									id="layout-background"
									type="color"
									value={layout.backgroundColor}
									disabled={locked}
									onChange={(event) =>
										edit((current) => ({
											...current,
											backgroundColor: event.target.value,
										}))
									}
								/>
							</Field>
						</FieldGroup>
						<section aria-label="Layout layers" className="flex flex-col gap-2">
							<h3 className="font-medium">Layers · top first</h3>
							{[...layout.layers].reverse().map((layer, index) => (
								<Button
									key={layer.id}
									variant={selected === layer.id ? "secondary" : "outline"}
									className="justify-start truncate"
									onClick={() => setSelected(layer.id)}
								>
									{layout.layers.length - index}.{" "}
									{layer.kind === "text"
										? layer.text.slice(0, 32) || "Empty text"
										: "Logo"}
								</Button>
							))}
							{!layout.layers.length ? (
								<p className="text-muted-foreground">
									Add text or a logo to begin.
								</p>
							) : null}
						</section>
						{layer ? (
							<FieldGroup>
								<h3 className="font-medium">Selected {layer.kind} layer</h3>
								{layer.kind === "text" ? (
									<>
										<Field>
											<FieldLabel htmlFor="layout-text">Text</FieldLabel>
											<Textarea
												id="layout-text"
												maxLength={1000}
												value={layer.text}
												disabled={locked}
												onChange={(event) =>
													patchLayer(layer.id, { text: event.target.value })
												}
											/>
										</Field>
										<Choice
											label="Font"
											value={layer.font}
											items={[
												{ value: "sans", label: "Arial" },
												{ value: "serif", label: "Georgia" },
												{ value: "mono", label: "Courier New" },
											]}
											disabled={locked}
											onChange={(value) =>
												patchLayer(layer.id, {
													font: value as "sans" | "serif" | "mono",
												})
											}
										/>
										<NumberField
											label="Font size (px)"
											value={layer.fontSize * layout.width}
											min={Math.ceil(layout.width * 0.008)}
											max={Math.floor(layout.width * 0.3)}
											disabled={locked}
											onChange={(value) =>
												patchLayer(layer.id, { fontSize: value / layout.width })
											}
										/>
										<Field>
											<FieldLabel>Weight</FieldLabel>
											<ToggleGroup
												value={[layer.bold ? "bold" : "regular"]}
												disabled={locked}
												variant="outline"
												onValueChange={(values) => {
													if (values[0])
														patchLayer(layer.id, {
															bold: values[0] === "bold",
														});
												}}
											>
												<ToggleGroupItem value="regular">
													Regular
												</ToggleGroupItem>
												<ToggleGroupItem value="bold">Bold</ToggleGroupItem>
											</ToggleGroup>
										</Field>
										<Field>
											<FieldLabel>Alignment</FieldLabel>
											<ToggleGroup
												aria-label="Text alignment"
												value={[layer.align]}
												disabled={locked}
												variant="outline"
												onValueChange={(values) => {
													if (values[0])
														patchLayer(layer.id, {
															align: values[0] as "left" | "center" | "right",
														});
												}}
											>
												{["left", "center", "right"].map((value) => (
													<ToggleGroupItem key={value} value={value}>
														{value}
													</ToggleGroupItem>
												))}
											</ToggleGroup>
										</Field>
										<Field>
											<FieldLabel htmlFor="layout-text-color">
												Text color
											</FieldLabel>
											<Input
												id="layout-text-color"
												type="color"
												value={layer.color}
												disabled={locked}
												onChange={(event) =>
													patchLayer(layer.id, { color: event.target.value })
												}
											/>
										</Field>
										<Field>
											<FieldLabel>Text background</FieldLabel>
											<ToggleGroup
												value={[layer.background ? "solid" : "none"]}
												disabled={locked}
												variant="outline"
												onValueChange={(values) => {
													if (values[0])
														patchLayer(layer.id, {
															background:
																values[0] === "solid" ? "#ffffff" : null,
														});
												}}
											>
												<ToggleGroupItem value="none">None</ToggleGroupItem>
												<ToggleGroupItem value="solid">Solid</ToggleGroupItem>
											</ToggleGroup>
											{layer.background ? (
												<Input
													aria-label="Text background color"
													type="color"
													value={layer.background}
													disabled={locked}
													onChange={(event) =>
														patchLayer(layer.id, {
															background: event.target.value,
														})
													}
												/>
											) : null}
										</Field>
									</>
								) : (
									<>
										<Choice
											label="Logo image"
											value={layer.assetId ?? "none"}
											items={assetItems}
											disabled={locked || media.pending}
											onChange={(value) =>
												patchLayer(layer.id, {
													assetId: value === "none" ? null : value,
												})
											}
										/>
										<Field>
											<FieldLabel htmlFor="layout-logo-upload">
												Upload logo
											</FieldLabel>
											<Input
												id="layout-logo-upload"
												type="file"
												accept={imageMimeTypes.join(",")}
												disabled={locked}
												onChange={(event) => {
													const file = event.currentTarget.files?.[0];
													event.currentTarget.value = "";
													if (file)
														void run(async () => {
															if (
																!imageMimeTypes.some(
																	(type) => type === file.type,
																)
															)
																throw new Error(
																	"Choose a PNG, JPEG, or WebP logo.",
																);
															const asset = await uploadProjectMedia(
																media.projectId,
																file,
															);
															await media.refresh();
															if (!latest.current.canEdit)
																throw new Error(
																	"Editing access changed. The logo is available in Media library.",
																);
															setHistory((current) => ({
																past: [
																	...current.past.slice(-49),
																	current.layout,
																],
																future: [],
																layout: {
																	...current.layout,
																	layers: current.layout.layers.map((item) =>
																		item.id === layer.id && item.kind === "logo"
																			? { ...item, assetId: asset.id }
																			: item,
																	),
																},
															}));
														});
												}}
											/>
											<FieldDescription>
												PNG with transparency is best. PNG/JPEG/WebP, up to 10
												MB.
											</FieldDescription>
										</Field>
										<NumberField
											label="Opacity (%)"
											value={layer.opacity * 100}
											min={0}
											max={100}
											disabled={locked}
											onChange={(value) =>
												patchLayer(layer.id, { opacity: value / 100 })
											}
										/>
									</>
								)}
								<div className="grid grid-cols-2 gap-3">
									{(["x", "y", "width", "height"] as const).map((field) => (
										<NumberField
											key={field}
											label={`${field === "x" ? "Left" : field === "y" ? "Top" : field === "width" ? "Width" : "Height"} (%)`}
											value={layer[field] * 100}
											min={field === "x" || field === "y" ? 0 : 2}
											max={100}
											disabled={locked}
											onChange={(value) =>
												patchLayer(
													layer.id,
													clampLayoutRect({ ...layer, [field]: value / 100 }),
												)
											}
										/>
									))}
								</div>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										disabled={locked || layout.layers.at(-1)?.id === selected}
										onClick={() => moveLayer(1)}
									>
										<ArrowUpIcon data-icon="inline-start" />
										Forward
									</Button>
									<Button
										variant="outline"
										disabled={locked || layout.layers[0]?.id === selected}
										onClick={() => moveLayer(-1)}
									>
										<ArrowDownIcon data-icon="inline-start" />
										Backward
									</Button>
									<Button
										variant="outline"
										disabled={locked}
										onClick={() => {
											edit((current) => ({
												...current,
												layers: current.layers.filter(
													(item) => item.id !== selected,
												),
											}));
											setSelected(null);
										}}
									>
										<Trash2Icon data-icon="inline-start" />
										Remove layer
									</Button>
								</div>
							</FieldGroup>
						) : null}
					</div>
				</div>
				{error ? (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				{discard && dirty ? (
					<Alert>
						<AlertDescription>
							<p>You have unsaved layout changes.</p>
							<div className="flex gap-2">
								<Button variant="outline" onClick={() => setDiscard(false)}>
									Keep editing
								</Button>
								<Button variant="destructive" onClick={close}>
									Discard changes
								</Button>
							</div>
						</AlertDescription>
					</Alert>
				) : null}
				<div className="flex flex-wrap items-center gap-2 border-t pt-3">
					<Button
						disabled={locked}
						onClick={() =>
							void run(async () => {
								await saveLayout();
								toast("Layout saved. Text and logos remain editable.");
							})
						}
					>
						<SaveIcon data-icon="inline-start" />
						Save layout
					</Button>
					<Button
						variant="outline"
						disabled={exportDisabled}
						onClick={() => void run(() => download("png"))}
					>
						<DownloadIcon data-icon="inline-start" />
						Download PNG
					</Button>
					<Button
						variant="outline"
						disabled={exportDisabled}
						onClick={() => void run(() => download("jpeg"))}
					>
						Download JPEG
					</Button>
					<Button
						variant="outline"
						disabled={exportDisabled || !canEdit}
						onClick={() =>
							void run(async () => {
								if (!loaded) return;
								await saveLayout();
								const blob = await exportImageLayout(
									layout,
									loaded.images,
									"png",
								);
								const asset = await uploadProjectMedia(
									media.projectId,
									new File([blob], `${node.data.label || "Image"} layout.png`, {
										type: "image/png",
									}),
								);
								await media.refresh();
								if (
									!latest.current.canEdit ||
									!latest.current.addImage(asset)
								) {
									toast(
										"Image saved to Media library. Use Add to canvas there when the canvas is ready.",
									);
									return;
								}
								toast(
									"Finished image added to canvas. Edit the original node to change its layout.",
								);
								close();
							})
						}
					>
						<ImagePlusIcon data-icon="inline-start" />
						Save image to canvas
					</Button>
					{busy ? <span role="status">Saving…</span> : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
