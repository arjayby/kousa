import type { ClipStore } from "@kousa/db/clip-store";
import type { ClipPlan } from "@kousa/db/schema/clip-runs";
import { clipActive } from "./clip-contracts";
import { maxVideoBytes } from "./contracts";
import type { MediaService } from "./service";
import type { MediaStorage } from "./storage";
export type ClipRenderer = (
	id: string,
	video: Uint8Array<ArrayBuffer>,
	audio: Uint8Array<ArrayBuffer>,
	plan: ClipPlan,
) => Promise<Uint8Array<ArrayBuffer>>;
export function createClipRunner(
	store: ClipStore,
	media: MediaService,
	receipts: MediaStorage & { delete: (key: string) => Promise<void> },
	render: ClipRenderer,
) {
	const key = (id: string) => `clip-receipts/${id}.mp4`;
	async function current(id: string) {
		const run = await store.get(id);
		if (!run || !clipActive(run.status)) return null;
		if (run.expiresAt.getTime() <= Date.now()) throw new Error("Clip expired");
		await media.authorize(run.userId, run.projectId, true);
		return run;
	}
	return {
		async render(id: string) {
			const run = await current(id);
			if (!run) return false;
			const receipt = await receipts.get(key(id));
			if (receipt) {
				await receipt.body.cancel();
				return true;
			}
			await store.phase(id, "rendering");
			const [video, audio] = await Promise.all([
				media.read(run.userId, run.projectId, run.plan.videoAssetId),
				media.read(run.userId, run.projectId, run.plan.audioAssetId),
			]);
			const [v, a] = await Promise.all([
				new Response(video.object.body).arrayBuffer(),
				new Response(audio.object.body).arrayBuffer(),
			]);
			const bytes = await render(
				id,
				new Uint8Array(v),
				new Uint8Array(a),
				run.plan,
			);
			if (bytes.length > maxVideoBytes)
				throw new Error("Clip exceeds media limit");
			await receipts.put(key(id), bytes, "video/mp4");
			return true;
		},
		async publish(id: string): Promise<undefined> {
			const run = await current(id);
			if (!run) return;
			await store.phase(id, "saving");
			const receipt = await receipts.get(key(id));
			if (!receipt) throw new Error("Clip output missing");
			const asset = await media.stageClip(run.userId, run.projectId, {
				bytes: new Uint8Array(await new Response(receipt.body).arrayBuffer()),
				mimeType: "video/mp4",
				name: `${run.plan.label} clip ${id.slice(0, 8)}.mp4`,
			});
			if (!(await store.finish(id, asset.id)))
				throw new Error("Clip publication rejected");
		},
		fail: (id: string) => store.fail(id),
		async cleanup(id: string) {
			const run = await store.get(id);
			if (!run || !clipActive(run.status)) await receipts.delete(key(id));
		},
	};
}
type Steps = {
	do<T extends boolean | undefined>(
		name: string,
		options: {
			retries: { limit: number; delay: number; backoff: "exponential" };
			timeout: number;
		},
		fn: () => Promise<T>,
	): Promise<T>;
};
export async function executeClipWorkflow(
	id: string,
	runner: ReturnType<typeof createClipRunner>,
	step: Steps,
) {
	const options = {
		retries: { limit: 3, delay: 5000, backoff: "exponential" as const },
		timeout: 240_000,
	};
	try {
		const rendered = await step.do("render-clip", options, () =>
			runner.render(id),
		);
		if (rendered) await step.do("save-clip", options, () => runner.publish(id));
	} catch {
		await step.do("fail-clip", options, async () => {
			await runner.fail(id);
			return undefined;
		});
	}
	await step.do("clean-clip-receipt", options, async () => {
		await runner.cleanup(id);
		return undefined;
	});
	return { runId: id };
}
