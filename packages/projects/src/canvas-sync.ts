import type { CanvasDocument } from "./canvas";

export type SavedCanvas = {
	document: CanvasDocument;
	revision: number;
	updatedAt: Date | null;
};
export type CanvasSaveStatus =
	| "saved"
	| "unsaved"
	| "saving"
	| "error"
	| "conflict"
	| "forbidden";
export type CanvasSyncState = {
	canEdit: boolean;
	status: CanvasSaveStatus;
	error: string | null;
	revision: number;
	dirty: boolean;
};
export function accessDenied(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(String(error.code))
	);
}

// One writer per editor. Edits made during a request wait for its new revision.
// The server remains the authority for authorization and compare-and-swap.
export function createCanvasSync(options: {
	initial: SavedCanvas;
	canEdit: boolean;
	save: (
		document: CanvasDocument,
		expectedRevision: number,
	) => Promise<SavedCanvas>;
	replace: (document: CanvasDocument) => void;
	delay?: number;
}) {
	let saved = options.initial;
	let desired = saved.document;
	let canEdit = options.canEdit;
	let active = true;
	let busy = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pendingRemote: SavedCanvas | undefined;
	let state: CanvasSyncState = {
		canEdit,
		status: "saved",
		error: null,
		revision: saved.revision,
		dirty: false,
	};
	const listeners = new Set<() => void>();
	const equal = (a: CanvasDocument, b: CanvasDocument) =>
		JSON.stringify(a) === JSON.stringify(b);
	const dirty = () => !equal(desired, saved.document);
	function publish(status: CanvasSaveStatus, error: string | null = null) {
		state = {
			canEdit,
			status,
			error,
			revision: saved.revision,
			dirty: dirty(),
		};
		for (const listener of listeners) listener();
	}
	function cancel() {
		clearTimeout(timer);
		timer = undefined;
	}
	function schedule() {
		cancel();
		if (active && canEdit && !busy && dirty() && state.status === "unsaved")
			timer = setTimeout(() => {
				void flush();
			}, options.delay ?? 700);
	}
	function receive(remote: SavedCanvas) {
		if (remote.revision <= saved.revision) return;
		if (busy) {
			if (!pendingRemote || remote.revision > pendingRemote.revision)
				pendingRemote = remote;
			return;
		}
		if (dirty() && !equal(desired, remote.document)) {
			cancel();
			publish(
				"conflict",
				"Someone saved a newer canvas. Download your changes before loading the saved version.",
			);
			return;
		}
		const changed = !equal(desired, remote.document);
		saved = remote;
		desired = remote.document;
		cancel();
		if (changed) options.replace(desired);
		publish("saved");
	}
	async function flush() {
		cancel();
		if (
			!active ||
			!canEdit ||
			busy ||
			!dirty() ||
			["conflict", "forbidden", "error"].includes(state.status)
		)
			return;
		const sent = desired;
		busy = true;
		publish("saving");
		try {
			const result = await options.save(sent, saved.revision);
			saved = result;
			if (!canEdit && dirty())
				publish(
					"forbidden",
					"Your edit access has changed. Download your changes to keep a copy.",
				);
			else publish(dirty() ? "unsaved" : "saved");
		} catch (error) {
			if (accessDenied(error)) {
				canEdit = false;
				publish(
					"forbidden",
					"Your edit access has changed. Your unsaved changes have not been published.",
				);
			} else if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "CONFLICT"
			) {
				publish(
					"conflict",
					"Someone saved a newer canvas. Download your changes before loading the saved version.",
				);
			} else {
				publish(
					"error",
					"The canvas could not be saved. Check your connection, then retry.",
				);
			}
		} finally {
			busy = false;
			if (pendingRemote) {
				const remote = pendingRemote;
				pendingRemote = undefined;
				receive(remote);
			}
			schedule();
		}
	}
	return {
		getSnapshot: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setActive(value: boolean) {
			active = value;
			if (!value) cancel();
			else schedule();
		},
		setCanEdit(value: boolean) {
			canEdit = value;
			if (!value) {
				cancel();
				if (dirty())
					publish(
						"forbidden",
						"Your edit access has changed. Download your changes to keep a copy.",
					);
			} else if (state.status === "forbidden") {
				// An access refresh must not silently resume an old, rejected draft.
				publish(
					"error",
					"Edit access restored. Retry saving or load the saved version.",
				);
			}
			if (state.canEdit !== canEdit) publish(state.status, state.error);
		},
		edit(document: CanvasDocument) {
			if (!canEdit || equal(desired, document)) return;
			desired = document;
			if (busy) publish("saving");
			else if (["conflict", "forbidden", "error"].includes(state.status))
				publish(state.status, state.error);
			else publish(dirty() ? "unsaved" : "saved");
			schedule();
		},
		receive,
		flush,
		retry() {
			if (canEdit && !busy && state.status === "error") {
				publish("unsaved");
				void flush();
			}
		},
		reset(remote: SavedCanvas) {
			if (busy) return false;
			cancel();
			saved = remote;
			desired = remote.document;
			options.replace(desired);
			if (canEdit) publish("saved");
			else
				publish(
					"forbidden",
					"Changes are disabled for this account. Reload the page to check your current access.",
				);
			return true;
		},
	};
}
