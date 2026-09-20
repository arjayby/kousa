import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const rect = {
	id: z.uuid(),
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	width: z.number().min(0.02).max(1),
	height: z.number().min(0.02).max(1),
};
export const layoutLayerSchema = z
	.discriminatedUnion("kind", [
		z.object({
			...rect,
			kind: z.literal("text"),
			text: z.string().max(1000),
			font: z.enum(["sans", "serif", "mono"]),
			fontSize: z.number().min(0.008).max(0.3),
			bold: z.boolean(),
			align: z.enum(["left", "center", "right"]),
			color,
			background: color.nullable(),
		}),
		z.object({
			...rect,
			kind: z.literal("logo"),
			assetId: z.uuid().nullable(),
			opacity: z.number().min(0).max(1),
		}),
	])
	.refine(
		(layer) =>
			layer.x + layer.width <= 1.000001 && layer.y + layer.height <= 1.000001,
		"Keep the layer inside the artboard.",
	);
export const imageLayoutSchema = z
	.object({
		version: z.literal(1),
		width: z.number().int().min(64).max(4096),
		height: z.number().int().min(64).max(4096),
		backgroundAssetId: z.uuid().nullable(),
		fit: z.enum(["cover", "contain"]),
		backgroundColor: color,
		layers: z.array(layoutLayerSchema).max(20),
	})
	.refine(
		(layout) =>
			new Set(layout.layers.map((layer) => layer.id)).size ===
			layout.layers.length,
		"Layer IDs must be unique.",
	);
export type ImageLayout = z.infer<typeof imageLayoutSchema>;
export type LayoutLayer = ImageLayout["layers"][number];
export type LayoutRect = Pick<LayoutLayer, "x" | "y" | "width" | "height">;
export const layoutFonts = {
	sans: "Arial, sans-serif",
	serif: "Georgia, serif",
	mono: "Courier New, monospace",
} as const;
export const layoutPresets = [
	{ label: "Square · 1080 × 1080", width: 1080, height: 1080 },
	{ label: "Portrait · 1080 × 1350", width: 1080, height: 1350 },
	{ label: "Story · 1080 × 1920", width: 1080, height: 1920 },
	{ label: "Landscape · 1920 × 1080", width: 1920, height: 1080 },
] as const;
export function createImageLayout(
	assetId: string | null,
	width = 1080,
	height = 1080,
): ImageLayout {
	const scale = Math.min(1, 4096 / Math.max(width, height));
	return {
		version: 1,
		width: Math.max(64, Math.round(width * scale)),
		height: Math.max(64, Math.round(height * scale)),
		backgroundAssetId: assetId,
		fit: "contain",
		backgroundColor: "#ffffff",
		layers: [],
	};
}
export function createTextLayer(): LayoutLayer {
	return {
		id: crypto.randomUUID(),
		kind: "text",
		x: 0.08,
		y: 0.08,
		width: 0.84,
		height: 0.22,
		text: "Your headline",
		font: "sans",
		fontSize: 0.06,
		bold: true,
		align: "center",
		color: "#1c1917",
		background: null,
	};
}
export function clampLayoutRect(rect: LayoutRect): LayoutRect {
	const width = Math.max(0.02, Math.min(1, rect.width));
	const height = Math.max(0.02, Math.min(1, rect.height));
	return {
		width,
		height,
		x: Math.max(0, Math.min(1 - width, rect.x)),
		y: Math.max(0, Math.min(1 - height, rect.y)),
	};
}
export function layoutAssetIds(layout?: ImageLayout) {
	return [
		...new Set(
			[
				layout?.backgroundAssetId,
				...(layout?.layers.flatMap((layer) =>
					layer.kind === "logo" ? [layer.assetId] : [],
				) ?? []),
			].filter((id): id is string => Boolean(id)),
		),
	];
}
export function templateImageLayout(layout: ImageLayout): ImageLayout {
	return {
		...layout,
		backgroundAssetId: null,
		layers: layout.layers.map((layer) =>
			layer.kind === "logo" ? { ...layer, assetId: null } : { ...layer },
		),
	};
}
export function fitLayoutImage(
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
	fit: ImageLayout["fit"],
) {
	const scale = (fit === "cover" ? Math.max : Math.min)(
		width / sourceWidth,
		height / sourceHeight,
	);
	return {
		x: (width - sourceWidth * scale) / 2,
		y: (height - sourceHeight * scale) / 2,
		width: sourceWidth * scale,
		height: sourceHeight * scale,
	};
}
// Preserve explicit newlines and break long words so a URL cannot spill outside its box.
export function wrapLayoutText(
	text: string,
	width: number,
	measure: (text: string) => number,
) {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate) <= width) {
				line = candidate;
				continue;
			}
			if (line) {
				lines.push(line);
				line = "";
			}
			for (const char of Array.from(word)) {
				if (line && measure(line + char) > width) {
					lines.push(line);
					line = "";
				}
				line += char;
			}
		}
		lines.push(line);
	}
	return lines;
}
