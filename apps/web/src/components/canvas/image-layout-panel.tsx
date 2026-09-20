"use client";

import type { PublicAsset } from "@kousa/media/contracts";
import { imageOutputAssetId } from "@kousa/projects/canvas";
import { Button } from "@kousa/ui/components/button";
import { LayoutTemplateIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { ApplyHistory } from "./generation-history";
import type { StudioNode } from "./use-canvas";

const ImageLayoutEditor = dynamic(() => import("./image-layout-editor"), {
	loading: () => <p role="status">Opening layout editor…</p>,
});
export function ImageLayoutPanel({
	node,
	generatedAssetId,
	canEdit,
	apply,
	addImage,
}: {
	node: StudioNode;
	generatedAssetId?: string | null;
	canEdit: boolean;
	apply: ApplyHistory;
	addImage: (asset: PublicAsset) => boolean;
}) {
	const [open, setOpen] = useState(false);
	const assetId = imageOutputAssetId(node.data, generatedAssetId) ?? null;
	return (
		<section aria-label="Image layout" className="flex flex-col gap-2">
			<h3 className="font-medium text-xs">Text, logo & export</h3>
			<p className="text-muted-foreground text-xs">
				Place editable text and logos over your image. Export or save a finished
				image to the canvas. No generation credits.
			</p>
			<Button
				variant="outline"
				disabled={!assetId && !node.data.imageLayout}
				onClick={() => setOpen(true)}
			>
				<LayoutTemplateIcon data-icon="inline-start" />
				{node.data.imageLayout ? "Open saved layout" : "Add text & logo"}
			</Button>
			{!assetId && !node.data.imageLayout ? (
				<p className="text-muted-foreground text-xs">
					Upload or generate an image first.
				</p>
			) : null}
			{open ? (
				<ImageLayoutEditor
					node={node}
					assetId={assetId}
					canEdit={canEdit}
					apply={apply}
					addImage={addImage}
					close={() => setOpen(false)}
				/>
			) : null}
		</section>
	);
}
