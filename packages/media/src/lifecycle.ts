import type { MediaLifecycleStore } from "@kousa/db/media-lifecycle-store";
import type { ProjectStore } from "@kousa/db/project-store";
import {
	type CanvasDocument,
	canvasDocumentSchema,
} from "@kousa/projects/canvas";
import { MediaError, objectKey } from "./service";
import type { MediaStorage } from "./storage";

export const abandonedUploadDays = 7;
export function createMediaLifecycle(
	store: MediaLifecycleStore,
	projects: Pick<ProjectStore, "get">,
	storage: MediaStorage,
	readRoom: (room: string) => Promise<CanvasDocument>,
) {
	async function authorize(actor: string, project: string, write = false) {
		const found = await projects.get(actor, project);
		if (!found) throw new MediaError(404, "Project not found.");
		if (write && found.role === "viewer")
			throw new MediaError(403, "Only owners and editors can manage media.");
	}
	async function graph(projectId: string) {
		const saved = await store.canvas(projectId);
		if (!saved.length) throw new MediaError(404, "Project not found.");
		const documents = await Promise.all(
			saved.map((canvas) =>
				canvas.room
					? readRoom(canvas.room)
					: canvasDocumentSchema.parse(canvas.canvas),
			),
		);
		return { nodes: documents.flatMap((document) => document.nodes) };
	}
	async function inspect(projectId: string) {
		const [assets, records, snapshot] = await Promise.all([
			store.assets(projectId),
			store.references(projectId),
			graph(projectId).catch(() => null),
		]);
		for (const asset of assets) {
			if (
				!asset.retentionReason &&
				snapshot?.nodes.some((node) => node.data.assetId === asset.id)
			) {
				await store.protectObserved(projectId, asset.id);
				asset.retentionReason = "canvas";
			}
		}
		const usage = assets.map((asset) => {
			const retained = records.filter((ref) => ref.assetId === asset.id);
			const references: { kind: string; label: string; nodeId?: string }[] = [];
			for (const node of snapshot?.nodes ?? []) {
				if (
					node.data.assetId === asset.id ||
					(node.data.selectedRunId &&
						retained.some((ref) => ref.id === node.data.selectedRunId))
				) {
					references.push({
						kind: "canvas",
						label: node.data.label || node.type,
						nodeId: node.id,
					});
				}
			}
			for (const ref of retained)
				references.push({
					kind: ref.kind,
					label: `${ref.kind === "generation" ? "Generation" : ref.kind === "workflow" ? "Workflow" : "Clip"} ${ref.id.slice(0, 8)} · ${ref.status}`,
					nodeId: ref.nodeId,
				});
			const reason =
				asset.status === "deleting"
					? "Removal is in progress. Storage remains reserved until it finishes."
					: asset.status !== "ready"
						? "An unfinished upload or generation reserves this space."
						: asset.writes
							? "An upload is still active or its completion is uncertain. Retry the original upload before managing this file."
							: asset.retentionReason === "legacy"
								? "Kept for existing canvas history and offline undo from before media tracking."
								: asset.retentionReason === "canvas"
									? "Kept for shared canvas use and undo, including deleted nodes and offline drafts."
									: retained.length || asset.retentionReason
										? "Kept by generation or clip history, including inputs and selected older outputs."
										: !snapshot
											? "The shared canvas could not be checked. Retry before removing media."
											: references.length
												? "Used by the shared canvas."
												: !asset.uploadedAt
													? "Upload completion has not been confirmed."
													: null;
			return {
				assetId: asset.id,
				references,
				removable: reason === null,
				reason,
				cleanupAt:
					reason === null && asset.uploadedAt
						? new Date(
								asset.uploadedAt.getTime() + abandonedUploadDays * 86400000,
							).toISOString()
						: null,
			};
		});
		return {
			storage: {
				files: assets.length,
				bytes: assets.reduce((sum, a) => sum + a.bytes, 0),
				pendingFiles: assets.filter((a) => a.status === "pending").length,
				pendingBytes: assets
					.filter((a) => a.status === "pending")
					.reduce((sum, a) => sum + a.bytes, 0),
				removingFiles: assets.filter((a) => a.status === "deleting").length,
				maxFiles: 100,
				maxBytes: 100 * 1024 * 1024,
			},
			assets,
			usage,
			graphAvailable: snapshot !== null,
		};
	}
	async function erase(
		projectId: string,
		assetId: string,
		actorId: string | null,
		abandoned: boolean,
	) {
		const state = await inspect(projectId);
		const asset = state.assets.find((a) => a.id === assetId);
		if (!asset) return; // A completed tombstone makes retries idempotent.
		const usage = state.usage.find((a) => a.assetId === assetId);
		if (asset.status !== "deleting" && !usage?.removable)
			throw new MediaError(409, usage?.reason ?? "Media is retained.");
		const claim = await store.claim(projectId, assetId, actorId, abandoned);
		if (claim === "deleted") return;
		if (claim !== "deleting")
			throw new MediaError(
				claim === "forbidden" ? 403 : 409,
				"This file is now retained, being uploaded, or too recent for cleanup. Refresh its usage.",
			);
		if (!storage.delete) throw new Error("Media deletion is unavailable");
		await storage.delete(objectKey(asset));
		await store.deleted(asset.id);
	}
	return {
		async inspect(actorId: string, projectId: string) {
			await authorize(actorId, projectId);
			const { assets: _, ...result } = await inspect(projectId);
			return result;
		},
		async retain(actorId: string, projectId: string, assetId: string) {
			await authorize(actorId, projectId, true);
			if (!(await store.retain(actorId, projectId, assetId)))
				throw new MediaError(
					409,
					"This file is no longer available. Refresh Media library and choose another file.",
				);
		},
		async protectLegacyList(actorId: string, projectId: string) {
			await authorize(actorId, projectId);
			await store.protectLegacyList(projectId);
		},
		async remove(actorId: string, projectId: string, assetId: string) {
			await authorize(actorId, projectId, true);
			await erase(projectId, assetId, actorId, false);
		},
		async cleanup() {
			let removed = 0;
			let deferred = 0;
			for (const { projectId } of await store.candidates()) {
				const candidates = await store.assets(projectId);
				for (const asset of candidates) {
					if (
						asset.status !== "deleting" &&
						(asset.retentionReason ||
							!asset.uploadedAt ||
							asset.uploadedAt.getTime() >
								Date.now() - abandonedUploadDays * 86400000)
					)
						continue;
					try {
						await erase(projectId, asset.id, null, true);
						removed++;
					} catch {
						deferred++;
					}
				}
			}
			return { removed, deferred };
		},
	};
}
export type MediaLifecycle = ReturnType<typeof createMediaLifecycle>;
