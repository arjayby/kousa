import type * as Y from "yjs";

export type CanvasPresence = {
	cursor: { x: number; y: number } | null;
	selection: string[];
};
export type CanvasPeer = CanvasPresence & {
	connectionId: number;
	userId: string;
	name: string;
	canEdit: boolean;
};
export type CollaborationState = {
	connection: "connecting" | "connected" | "reconnecting" | "disconnected";
	loaded: boolean;
	canWrite: boolean;
	sync: "loading" | "synchronizing" | "synchronized";
	error: string | null;
	backupError: string | null;
};
export interface CanvasSession {
	doc: Y.Doc;
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => CollaborationState;
	subscribePeers: (listener: () => void) => () => void;
	getPeers: () => CanvasPeer[];
	updatePresence: (presence: Partial<CanvasPresence>) => void;
	reconnect: () => void;
	destroy: () => void;
}

export function collaboratorColor(id: string) {
	let hash = 0;
	for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
	return `hsl(${Math.abs(hash) % 360} 65% 43%)`;
}
