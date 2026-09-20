import {
	imageMimeTypes,
	maxImageBytes,
	mediaUrl,
} from "@kousa/media/contracts";
import {
	fitLayoutImage,
	type ImageLayout,
	layoutFonts,
	wrapLayoutText,
} from "@kousa/projects/image-layout";

export type LayoutImages = Map<string, ImageBitmap>;
export async function loadLayoutImages(
	projectId: string,
	assetIds: string[],
	signal: AbortSignal,
) {
	const images: LayoutImages = new Map();
	try {
		// Await every loader before cleanup, including images which finish after a failure.
		const results = await Promise.allSettled(
			assetIds.map(async (id) => {
				const response = await fetch(mediaUrl(projectId, id), {
					signal,
					cache: "no-store",
				});
				if (!response.ok)
					throw new Error(
						"An image is unavailable. Choose another project image or upload it again.",
					);
				const blob = await response.blob();
				if (
					!imageMimeTypes.some((type) => type === blob.type) ||
					blob.size > maxImageBytes
				)
					throw new Error("Choose a PNG, JPEG, or WebP image up to 10 MB.");
				const image = await createImageBitmap(blob);
				images.set(id, image);
			}),
		);
		const failed = results.find((result) => result.status === "rejected");
		if (failed?.status === "rejected") throw failed.reason;
		if (signal.aborted) throw new Error("Image loading cancelled.");
		return images;
	} catch (error) {
		for (const image of images.values()) image.close();
		throw error;
	}
}

// The preview and exported pixels share this renderer, including text wrapping.
export function renderImageLayout(
	canvas: HTMLCanvasElement,
	layout: ImageLayout,
	images: LayoutImages,
) {
	canvas.width = layout.width;
	canvas.height = layout.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("This browser cannot render the layout.");
	ctx.fillStyle = layout.backgroundColor;
	ctx.fillRect(0, 0, layout.width, layout.height);
	if (layout.backgroundAssetId) {
		const image = images.get(layout.backgroundAssetId);
		if (!image) throw new Error("The background image has not loaded.");
		const box = fitLayoutImage(
			image.width,
			image.height,
			layout.width,
			layout.height,
			layout.fit,
		);
		ctx.drawImage(image, box.x, box.y, box.width, box.height);
	}
	const clipped: string[] = [];
	for (const layer of layout.layers) {
		const x = layer.x * layout.width;
		const y = layer.y * layout.height;
		const width = layer.width * layout.width;
		const height = layer.height * layout.height;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, width, height);
		ctx.clip();
		if (layer.kind === "logo") {
			const image = layer.assetId ? images.get(layer.assetId) : null;
			if (!image) {
				ctx.restore();
				throw new Error(
					"Choose an image for every logo layer before exporting.",
				);
			}
			const box = fitLayoutImage(
				image.width,
				image.height,
				width,
				height,
				"contain",
			);
			ctx.globalAlpha = layer.opacity;
			ctx.drawImage(image, x + box.x, y + box.y, box.width, box.height);
		} else {
			if (layer.background) {
				ctx.fillStyle = layer.background;
				ctx.fillRect(x, y, width, height);
			}
			const size = layer.fontSize * layout.width;
			const padding = Math.min(width * 0.04, size * 0.25);
			const lineHeight = size * 1.25;
			ctx.font = `${layer.bold ? "700" : "400"} ${size}px ${layoutFonts[layer.font]}`;
			ctx.textAlign = layer.align;
			ctx.textBaseline = "top";
			ctx.fillStyle = layer.color;
			const lines = wrapLayoutText(
				layer.text,
				width - padding * 2,
				(text) => ctx.measureText(text).width,
			);
			if (
				lines.length * lineHeight + padding * 2 > height ||
				lines.some((text) => ctx.measureText(text).width > width - padding * 2)
			)
				clipped.push(layer.id);
			const left =
				layer.align === "left"
					? x + padding
					: layer.align === "right"
						? x + width - padding
						: x + width / 2;
			for (const [index, text] of lines.entries())
				ctx.fillText(text, left, y + padding + index * lineHeight);
		}
		ctx.restore();
	}
	return clipped;
}
export async function exportImageLayout(
	layout: ImageLayout,
	images: LayoutImages,
	format: "png" | "jpeg",
) {
	const canvas = document.createElement("canvas");
	try {
		const clipped = renderImageLayout(canvas, layout, images);
		if (clipped.length)
			throw new Error(
				"Some text is clipped. Enlarge its box or reduce the font size before exporting.",
			);
		const mimeType = `image/${format}`;
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) => {
					if (!blob?.size || blob.type !== mimeType)
						reject(
							new Error("This browser could not export the selected format."),
						);
					else resolve(blob);
				},
				mimeType,
				0.94,
			),
		);
	} finally {
		canvas.width = canvas.height = 0;
	}
}
