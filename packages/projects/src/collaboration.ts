import { Buffer } from "node:buffer";
import type { ProjectStore } from "@kousa/db/project-store";
import type { CanvasDocument } from "./canvas";
import { seedCanvasDocument } from "./canvas-document";
import { projectIdInput } from "./contracts";
import { ProjectError } from "./service";

export type Collaborator = { id: string; name: string; image?: string | null };
export type CollaborationRole = "owner" | "editor" | "viewer";
export const canvasRoomId = (projectId: string) => `kousa-${projectId}`;

// Provider-specific room APIs stay behind this interface. The graph itself is Yjs.
export interface CollaborationProvider {
	ensureRoom(roomId: string, projectId: string): Promise<void>;
	seed(roomId: string, update: Uint8Array): Promise<void>;
	setAccess(
		roomId: string,
		userId: string,
		role: CollaborationRole | null,
	): Promise<void>;
	disconnect(roomId: string): Promise<void>;
	identify(user: Collaborator): Promise<{ body: string; status: number }>;
	read(roomId: string, strict?: boolean): Promise<CanvasDocument>;
}

export function createCollaborationService(
	store: ProjectStore,
	provider: CollaborationProvider | null,
) {
	function configured() {
		if (!provider)
			throw new ProjectError(
				"SERVICE_UNAVAILABLE",
				"Live collaboration is not configured yet. Add the Liveblocks secret key and restart the app.",
			);
		return provider;
	}
	async function withLock<T>(
		actorId: string,
		projectId: string,
		run: (
			state: NonNullable<
				Awaited<ReturnType<ProjectStore["lockCollaboration"]>>
			>,
			lockId: string,
		) => Promise<T>,
	) {
		const lockId = crypto.randomUUID();
		const state = await store.lockCollaboration(actorId, projectId, lockId);
		if (!state) {
			if (!(await store.get(actorId, projectId)))
				throw new ProjectError("NOT_FOUND");
			throw new ProjectError(
				"CONFLICT",
				"Project access is being updated. Please retry in a moment.",
			);
		}
		try {
			return await run(state, lockId);
		} finally {
			await store.unlockCollaboration(projectId, lockId);
		}
	}
	return {
		async join(user: Collaborator, input: unknown) {
			const { projectId } = projectIdInput.parse(input);
			// The lock query itself checks membership before any provider operations.
			await withLock(user.id, projectId, async (state, lockId) => {
				const access = await store.get(user.id, projectId);
				if (!access) throw new ProjectError("NOT_FOUND");
				const backend = configured();
				const roomId = state.roomId ?? canvasRoomId(projectId);
				let seed = state.seed;
				if (!state.roomId) {
					const encoded = Buffer.from(
						seedCanvasDocument(state.document as CanvasDocument),
					).toString("base64");
					seed = encoded;
					if (
						!(await store.prepareCollaboration(
							projectId,
							lockId,
							state.revision,
							roomId,
							encoded,
						))
					)
						throw new ProjectError(
							"CONFLICT",
							"The canvas changed while preparing collaboration. Please retry.",
						);
				}
				if (!state.ready) {
					if (!seed) throw new Error("Missing collaboration seed");
					await backend.ensureRoom(roomId, projectId);
					// Reusing the exact persisted update makes retries idempotent, including a
					// lost provider response. Never reseed from a newly constructed Y.Doc.
					await backend.seed(roomId, Buffer.from(seed, "base64"));
					if (!(await store.finishCollaboration(projectId, lockId)))
						throw new ProjectError(
							"CONFLICT",
							"Collaboration setup timed out. Please retry.",
						);
				}
				await backend.setAccess(roomId, user.id, access.role);
			});
			// Identity tokens carry no room grants. Issue outside the permission lease;
			// a concurrent revocation remains effective when this token is used.
			return configured().identify(user);
		},
		async read(roomId: string) {
			return configured().read(roomId);
		},
		async changeAccess<T>(
			actorId: string,
			projectId: string,
			userId: string,
			role: CollaborationRole | null,
			change: () => Promise<T>,
		) {
			return withLock(actorId, projectId, async (state) => {
				const actor = await store.get(actorId, projectId);
				if (actor?.role !== "owner") throw new ProjectError("FORBIDDEN");
				if (state.ready && state.roomId) {
					const backend = configured();
					// Provider permission changes and socket invalidation must succeed before
					// reporting the database role change as complete. Fail closed on outages.
					await backend.setAccess(state.roomId, userId, null);
					await backend.disconnect(state.roomId);
				}
				const result = await change();
				if (result && role && state.ready && state.roomId)
					await configured().setAccess(state.roomId, userId, role);
				return result;
			});
		},
	};
}
export type CollaborationService = ReturnType<
	typeof createCollaborationService
>;
