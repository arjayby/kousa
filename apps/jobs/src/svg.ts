import { Resvg } from "@cf-wasm/resvg/workerd";

// Resvg has no network loader. External SVG resources are never fetched.
export async function rasterizeSvg(bytes: Uint8Array<ArrayBuffer>) {
	if (!bytes.length || bytes.length > 2_000_000)
		throw new Error("SVG exceeds 2 MB");
	const renderer = await Resvg.async(bytes, {
		fitTo: { mode: "width", value: 1024 },
	});
	try {
		if (
			renderer.width <= 0 ||
			renderer.height <= 0 ||
			(renderer.height / renderer.width) * 1024 > 4096
		)
			throw new Error("Unsupported SVG dimensions");
		const rendered = renderer.render();
		try {
			return new Uint8Array(rendered.asPng());
		} finally {
			rendered.free();
		}
	} finally {
		renderer.free();
	}
}
