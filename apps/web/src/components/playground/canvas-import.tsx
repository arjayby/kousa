"use client";

import type { CanvasNode } from "@kousa/projects/canvas";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { z } from "zod";
import { client } from "@/utils/orpc";

export function PlaygroundCanvasImport({
	userId,
	projectId,
	canvasId,
	ready,
	onImport,
}: {
	userId: string;
	projectId: string;
	canvasId: string;
	ready: boolean;
	onImport: (node: CanvasNode) => boolean;
}) {
	const params = useSearchParams();
	const runId = params.get("playground");
	const valid = z.uuid().safeParse(runId).success;
	const result = useQuery({
		queryKey: ["playground", userId, "import", projectId, canvasId, runId],
		queryFn: () =>
			client.playground.importToCanvas({
				runId: runId ?? "",
				projectId,
				canvasId,
			}),
		enabled: valid && ready,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
	useEffect(() => {
		if (!runId || !ready || !result.data) return;
		if (onImport(result.data.node)) {
			const url = new URL(window.location.href);
			url.searchParams.delete("playground");
			window.history.replaceState(null, "", url.pathname + url.search);
		}
	}, [runId, ready, result.data, onImport]);
	if (!runId) return null;
	return (
		<Alert>
			<AlertTitle>
				{result.isError || !valid
					? "Could not add generation"
					: "Adding from Playground"}
			</AlertTitle>
			<AlertDescription>
				{!valid
					? "This generation link is invalid."
					: result.isError
						? result.error.message
						: !ready
							? "Waiting for the canvas to connect…"
							: "Saving your result and settings to this canvas…"}
				{result.isError ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void result.refetch()}
					>
						Retry
					</Button>
				) : null}
			</AlertDescription>
		</Alert>
	);
}
