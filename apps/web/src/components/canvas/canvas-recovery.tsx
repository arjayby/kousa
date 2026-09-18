"use client";

import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import { useEffect, useState } from "react";
import type { CollaborationState } from "./collaboration-session";

export function CanvasRecovery({
	sync,
	allowedToEdit,
	retry,
	download,
}: {
	sync: CollaborationState;
	allowedToEdit: boolean;
	retry: () => void;
	download: () => void;
}) {
	const [slow, setSlow] = useState(false);
	const waiting =
		!sync.loaded ||
		sync.connection !== "connected" ||
		sync.sync !== "synchronized";
	useEffect(() => {
		setSlow(false);
		if (!waiting) return;
		const timer = setTimeout(() => setSlow(true), 10_000);
		return () => clearTimeout(timer);
	}, [waiting]);
	const accessChanged =
		sync.loaded &&
		allowedToEdit &&
		!sync.canWrite &&
		sync.connection === "connected";
	const reconnecting = sync.loaded && sync.connection !== "connected";
	if (
		!sync.error &&
		!sync.backupError &&
		!accessChanged &&
		!reconnecting &&
		!slow
	)
		return null;
	const title = sync.error
		? "Canvas connection needs attention"
		: accessChanged
			? "Editing access changed"
			: reconnecting
				? "Reconnecting to the canvas"
				: slow
					? "Saving is taking longer than usual"
					: "Browser recovery unavailable";
	return (
		<Alert
			variant={sync.error ? "destructive" : "default"}
			role={sync.error ? "alert" : "status"}
		>
			<AlertTitle>
				{!sync.loaded && !sync.error
					? "Still loading the shared canvas"
					: title}
			</AlertTitle>
			<AlertDescription>
				{sync.error ? <p>{sync.error}</p> : null}
				{sync.backupError ? <p>{sync.backupError}</p> : null}
				<p>
					{accessChanged
						? "Your current session cannot edit. Retry to check access, or ask the project owner for editing access."
						: waiting || sync.error
							? "Check your internet connection and retry. Generation and canvas uploads wait until the canvas is connected and saved."
							: "The shared canvas is connected, but this browser cannot keep a recovery copy."}
				</p>
				{sync.loaded ? (
					<p>
						Keep this tab open while saving. Download your changes before
						reloading if you need a copy.
					</p>
				) : (
					<p>
						Your existing workflow has not been replaced. Wait for it to load
						before adding nodes.
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{waiting || sync.error || accessChanged ? (
						<Button variant="outline" size="sm" onClick={retry}>
							Retry connection
						</Button>
					) : null}
					{sync.loaded ? (
						<Button variant="outline" size="sm" onClick={download}>
							Download my changes
						</Button>
					) : null}
				</div>
			</AlertDescription>
		</Alert>
	);
}
