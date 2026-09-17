import type { ClipRun, ClipStore } from "@kousa/db/clip-store";
import type { GenerationStore } from "@kousa/db/generation-store";
import type { MediaStore } from "@kousa/db/media-store";
import type { ClipPlan } from "@kousa/db/schema/clip-runs";
import type { ProjectService } from "@kousa/projects/service";
import {
	clipActive,
	clipPreviewInput,
	clipProjectInput,
	clipSettingsSchema,
	clipStartInput,
} from "./clip-contracts";

export class ClipError extends Error {
	constructor(
		public code:
			| "BAD_REQUEST"
			| "FORBIDDEN"
			| "CONFLICT"
			| "SERVICE_UNAVAILABLE",
		message: string,
	) {
		super(message);
	}
}
export function publicClip(run: ClipRun) {
	return {
		id: run.id,
		nodeId: run.nodeId,
		status: run.status,
		assetId: run.assetId,
		error: run.error,
		createdAt: run.createdAt.toISOString(),
		plan: run.plan,
	};
}
export function createClipService(
	store: ClipStore,
	generations: Pick<GenerationStore, "outputs">,
	media: Pick<MediaStore, "get" | "list">,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	jobs: {
		configured: () => Promise<boolean>;
		dispatch: (id: string) => Promise<void>;
	},
) {
	async function access(actorId: string, projectId: string, edit = false) {
		const project = await projects.get(actorId, { projectId });
		if (edit && !project.permissions.canEdit)
			throw new ClipError(
				"FORBIDDEN",
				"Only owners and editors can create clips.",
			);
	}
	async function preview(actorId: string, raw: unknown) {
		const { projectId, nodeId } = clipPreviewInput.parse(raw);
		await access(actorId, projectId, true);
		const { document } = await projects.getCanvas(actorId, { projectId });
		const node = document.nodes.find((n) => n.id === nodeId);
		if (node?.type !== "video")
			throw new ClipError("BAD_REQUEST", "Select a Video node.");
		const audioEdge = document.edges.find(
			(e) => e.target === node.id && e.targetHandle === "audio",
		);
		const audioNode = document.nodes.find(
			(n) => n.id === audioEdge?.source && n.type === "speech",
		);
		if (!audioNode)
			throw new ClipError(
				"BAD_REQUEST",
				"Connect a Speech node to this video's Audio input.",
			);
		const [videos, audio] = await Promise.all([
			generations.outputs(projectId, [node.id], "video"),
			generations.outputs(projectId, [audioNode.id], "speech"),
		]);
		const videoId =
			node.data.mediaSource === "project"
				? node.data.assetId
				: videos[0]?.assetId;
		const audioId =
			audioNode.data.mediaSource === "project"
				? audioNode.data.assetId
				: audio[0]?.assetId;
		const [videoAsset, audioAsset] = await Promise.all([
			videoId ? media.get(projectId, videoId) : null,
			audioId ? media.get(projectId, audioId) : null,
		]);
		if (videoAsset?.mimeType !== "video/mp4" || !videoAsset.durationMs)
			throw new ClipError(
				"BAD_REQUEST",
				"Generate a video or choose a project video first.",
			);
		if (audioAsset?.mimeType !== "audio/mpeg")
			throw new ClipError(
				"BAD_REQUEST",
				"Generate speech or choose project speech first.",
			);
		const settings = clipSettingsSchema.parse(node.data.clipSettings ?? {});
		if (settings.narrationStartMs >= videoAsset.durationMs)
			throw new ClipError(
				"BAD_REQUEST",
				"Narration must start before the video ends.",
			);
		const plan: ClipPlan = {
			...settings,
			videoAssetId: videoAsset.id,
			audioAssetId: audioAsset.id,
			audioNodeId: audioNode.id,
			label: node.data.label || "Clip",
			durationMs: videoAsset.durationMs,
			transcript:
				audioNode.data.mediaSource === "project"
					? ((await media.list(projectId)).find((a) => a.id === audioAsset.id)
							?.transcript ?? null)
					: (audio[0]?.prompt ?? null),
		};
		const hash = new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(JSON.stringify({ projectId, nodeId, plan })),
			),
		);
		return {
			plan,
			inputHash: Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(
				"",
			),
			configured: await jobs.configured(),
			audioDurationMs: audioAsset.durationMs,
		};
	}
	async function dispatch(run: ClipRun) {
		if (clipActive(run.status)) {
			try {
				await jobs.dispatch(run.id);
			} catch {
				/* Persisted outbox is retried by recovery. */
			}
		}
	}
	return {
		preview,
		async list(actorId: string, raw: unknown) {
			const { projectId } = clipProjectInput.parse(raw);
			await access(actorId, projectId);
			const [runs, results, configured] = await Promise.all([
				store.latest(projectId),
				store.latest(projectId, true),
				jobs.configured(),
			]);
			return {
				runs: runs.map(publicClip),
				results: results.map(publicClip),
				configured,
			};
		},
		async start(actorId: string, raw: unknown) {
			const input = clipStartInput.parse(raw);
			await access(actorId, input.projectId, true);
			const existing = await store.get(input.id);
			if (existing) {
				if (
					existing.userId !== actorId ||
					existing.projectId !== input.projectId ||
					existing.nodeId !== input.nodeId ||
					existing.inputHash !== input.inputHash
				)
					throw new ClipError(
						"CONFLICT",
						"This request belongs to a different clip.",
					);
				await dispatch(existing);
				return publicClip(existing);
			}
			const prepared = await preview(actorId, input);
			if (prepared.inputHash !== input.inputHash)
				throw new ClipError(
					"CONFLICT",
					"Clip inputs changed. Review the clip again.",
				);
			if (!prepared.configured)
				throw new ClipError(
					"SERVICE_UNAVAILABLE",
					"The clip renderer is not configured.",
				);
			const claim = await store.claim({
				...input,
				userId: actorId,
				plan: prepared.plan,
			});
			if (claim === "FORBIDDEN")
				throw new ClipError("FORBIDDEN", "Your editing access has changed.");
			if (claim === "BUSY")
				throw new ClipError(
					"CONFLICT",
					"Wait for the active clip in this project or your account to finish.",
				);
			if (claim === "CONFLICT")
				throw new ClipError(
					"CONFLICT",
					"This request belongs to a different clip.",
				);
			const run = await store.get(input.id);
			if (!run) throw new Error("Clip job missing");
			await dispatch(run);
			return publicClip(run);
		},
	};
}
export type ClipService = ReturnType<typeof createClipService>;
