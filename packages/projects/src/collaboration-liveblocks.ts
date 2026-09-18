import { Liveblocks, LiveblocksError } from "@liveblocks/node";
import * as Y from "yjs";
import { readCanvasDocument } from "./canvas-document";
import type { CollaborationProvider } from "./collaboration";

export function createLiveblocksProvider(
	secret: string | undefined,
): CollaborationProvider | null {
	if (!secret?.trim()) return null;
	const client = new Liveblocks({ secret: secret.trim() });
	const options = () => ({ signal: AbortSignal.timeout(10_000) });
	return {
		async ensureRoom(roomId, projectId) {
			try {
				await client.createRoom(
					roomId,
					{
						defaultAccesses: [],
						metadata: { projectId, schema: "kousa-yjs-v1" },
					},
					options(),
				);
			} catch (error) {
				if (!(error instanceof LiveblocksError) || error.status !== 409)
					throw error;
				const existing = await client.getRoom(roomId, options());
				if (
					existing.metadata.projectId !== projectId ||
					existing.metadata.schema !== "kousa-yjs-v1"
				)
					throw new Error("Unexpected collaboration room");
			}
		},
		async seed(roomId, update) {
			await client.sendYjsBinaryUpdate(roomId, update, undefined, options());
		},
		async setAccess(roomId, userId, role) {
			await client.updateRoom(
				roomId,
				{
					defaultAccesses: [],
					usersAccesses: {
						[userId]:
							role === null
								? null
								: role === "viewer"
									? ["room:read", "room:presence:write"]
									: ["room:write"],
					},
				},
				options(),
			);
		},
		async disconnect(roomId) {
			// Kousa stores EVERYTHING in Yjs, never Liveblocks Storage. This documented
			// endpoint clears unused Storage and disconnects all sockets while retaining
			// the Yjs document. Rejoins recheck ID-token room ACLs, including cached tokens.
			await client.deleteStorageDocument(roomId, options());
		},
		async identify(user) {
			return client.identifyUser(user.id, { userInfo: { name: user.name } });
		},
		async read(roomId, strict = false) {
			const update = await client.getYjsDocumentAsBinaryUpdate(
				roomId,
				undefined,
				options(),
			);
			const doc = new Y.Doc();
			try {
				Y.applyUpdate(doc, new Uint8Array(update));
				const result = readCanvasDocument(doc);
				if (strict && result.rejected)
					throw new Error(
						"Canvas contains unrecognized entries; media references cannot be verified",
					);
				return result.document;
			} finally {
				doc.destroy();
			}
		},
	};
}
