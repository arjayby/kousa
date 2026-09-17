import { createClient } from "@liveblocks/client";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { z } from "zod";
import type {
	CanvasPeer,
	CanvasPresence,
	CanvasSession,
	CollaborationState,
} from "./collaboration-session";

export function createLiveblocksSession(
	userId: string,
	projectId: string,
): CanvasSession {
	const listeners = new Set<() => void>();
	const peerListeners = new Set<() => void>();
	let state: CollaborationState = {
		connection: "connecting",
		loaded: false,
		canWrite: false,
		sync: "loading",
		error: null,
		backupError: null,
	};
	let peers: CanvasPeer[] = [];
	let destroyed = false;
	let cache: IndexeddbPersistence | undefined;
	let cacheStarted = false;
	function patch(next: Partial<CollaborationState>) {
		if (destroyed) return;
		const updated = { ...state, ...next };
		if (JSON.stringify(updated) === JSON.stringify(state)) return;
		state = updated;
		for (const listener of listeners) listener();
	}
	const client = createClient({
		throttle: 50,
		preventUnsavedChanges: true,
		badgeLocation: "bottom-left",
		authEndpoint: async (room) => {
			const request = () =>
				fetch("/api/collaboration/auth", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ room }),
					signal: AbortSignal.timeout(60_000),
				});
			let response = await request();
			// Joining and membership changes share a short project lease. A second
			// tab should wait for that operation rather than show an auth failure.
			for (const delay of [300, 600, 1_200, 2_400]) {
				if (response.status !== 409 || destroyed) break;
				await response.body?.cancel();
				await new Promise((resolve) => setTimeout(resolve, delay));
				if (destroyed) throw new Error("Canvas closed");
				response = await request();
			}
			const result = z
				.object({
					userId: z.string().optional(),
					token: z.string().optional(),
					message: z.string().optional(),
				})
				.parse(await response.json());
			if (!response.ok || !result.token || result.userId !== userId) {
				const denied =
					response.status === 401 ||
					response.status === 403 ||
					response.status === 404 ||
					(response.ok && result.userId !== userId);
				patch({
					error: denied
						? "Your account or project access changed. Reload to check access."
						: (result.message ??
							"Could not connect to the shared canvas. Retry to reconnect."),
					canWrite: false,
				});
				if (denied)
					return { error: "forbidden", reason: "Project access changed" };
				throw new Error("Collaboration unavailable");
			}
			patch({ error: null });
			return { token: result.token };
		},
	});
	const { room, leave } = client.enterRoom<CanvasPresence>(
		`kousa-${projectId}`,
		{ initialPresence: { cursor: null, selection: [] }, autoConnect: false },
	);
	const provider = getYjsProviderForRoom(room);
	const doc = provider.getYDoc();
	function update() {
		const self = room.getSelf();
		const connection = room.getStatus();
		const permitted = self?.id === userId && self.canWrite;
		patch({
			connection: connection === "initial" ? "connecting" : connection,
			loaded: state.loaded || provider.synced,
			canWrite: Boolean(permitted),
			sync: provider.getStatus(),
		});
		// Restore only this account's cache, after the server has authorized a writer.
		// Viewers never merge former editor drafts back into the shared document.
		if (permitted && provider.synced && !cacheStarted) {
			cacheStarted = true;
			try {
				cache = new IndexeddbPersistence(
					`kousa:yjs:v1:${userId}:${projectId}`,
					doc,
				);
				void cache.whenSynced.catch(() =>
					patch({
						backupError:
							"Browser recovery is unavailable. Keep this tab open until changes are saved.",
					}),
				);
			} catch {
				patch({
					backupError:
						"Browser recovery is unavailable. Keep this tab open until changes are saved.",
				});
			}
		}
	}
	function updatePeers() {
		peers = room.getOthers().map((other) => ({
			connectionId: other.connectionId,
			userId: other.id ?? String(other.connectionId),
			name:
				typeof other.info?.name === "string" ? other.info.name : "Collaborator",
			canEdit: other.canWrite,
			cursor: validCursor(other.presence.cursor),
			selection: Array.isArray(other.presence.selection)
				? other.presence.selection
						.filter((id): id is string => typeof id === "string")
						.slice(0, 200)
				: [],
		}));
		for (const listener of peerListeners) listener();
	}
	const unsubscribe = [
		room.subscribe("status", update),
		room.subscribe("my-presence", update),
		room.subscribe("others", updatePeers),
		room.subscribe("error", () => {
			patch({
				canWrite: false,
				error:
					state.error ??
					"The shared canvas disconnected. Retry to check your access and reconnect.",
			});
		}),
	];
	provider.on("sync", update);
	provider.on("status", update);
	room.connect();
	return {
		doc,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => state,
		subscribePeers(listener) {
			peerListeners.add(listener);
			return () => {
				peerListeners.delete(listener);
			};
		},
		getPeers: () => peers,
		updatePresence(presence) {
			if (!destroyed) room.updatePresence(presence);
		},
		reconnect() {
			patch({ error: null });
			room.reconnect();
		},
		destroy() {
			if (destroyed) return;
			room.updatePresence({ cursor: null, selection: [] });
			destroyed = true;
			for (const stop of unsubscribe) stop();
			provider.off("sync", update);
			provider.off("status", update);
			void cache?.destroy();
			leave();
			doc.destroy();
			listeners.clear();
			peerListeners.clear();
		},
	};
}

function validCursor(value: unknown): CanvasPresence["cursor"] {
	if (!value || typeof value !== "object" || !("x" in value) || !("y" in value))
		return null;
	return typeof value.x === "number" &&
		Number.isFinite(value.x) &&
		typeof value.y === "number" &&
		Number.isFinite(value.y) &&
		Math.abs(value.x) <= 100_000 &&
		Math.abs(value.y) <= 100_000
		? { x: value.x, y: value.y }
		: null;
}
