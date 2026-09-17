"use client";
import { Avatar, AvatarFallback } from "@kousa/ui/components/avatar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@kousa/ui/components/tooltip";
import { useViewport } from "@xyflow/react";
import { useEffect, useSyncExternalStore } from "react";
import { type CanvasSession, collaboratorColor } from "./collaboration-session";

export function CanvasPeople({ session }: { session: CanvasSession }) {
	const state = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	const peers = useSyncExternalStore(
		session.subscribePeers,
		session.getPeers,
		session.getPeers,
	);
	if (state.connection !== "connected") return null;
	return (
		<section
			className="mr-3 flex items-center gap-2"
			aria-label={`${peers.length + 1} collaborators online`}
		>
			<span className="hidden text-muted-foreground text-xs sm:inline">
				{peers.length + 1} online
			</span>
			<div className="flex gap-1">
				{peers.slice(0, 5).map((peer) => (
					<Tooltip key={peer.connectionId}>
						<TooltipTrigger
							aria-label={`${peer.name}${peer.canEdit ? "" : ", view only"}`}
							className="rounded-full"
						>
							<Avatar className="size-7 ring-2 ring-background">
								<AvatarFallback
									style={{ color: collaboratorColor(peer.userId) }}
								>
									{initials(peer.name)}
								</AvatarFallback>
							</Avatar>
						</TooltipTrigger>
						<TooltipContent>
							{peer.name}
							{peer.canEdit ? "" : " · View only"}
							{peer.selection.length
								? ` · ${peer.selection.length} selected`
								: ""}
						</TooltipContent>
					</Tooltip>
				))}
			</div>
		</section>
	);
}
export function CanvasCursors({ session }: { session: CanvasSession }) {
	const peers = useSyncExternalStore(
		session.subscribePeers,
		session.getPeers,
		session.getPeers,
	);
	const { x, y, zoom } = useViewport();
	useEffect(() => {
		const clear = () => {
			if (document.hidden) session.updatePresence({ cursor: null });
		};
		document.addEventListener("visibilitychange", clear);
		return () => document.removeEventListener("visibilitychange", clear);
	}, [session]);
	return (
		<div className="studio-cursors" aria-hidden="true">
			{peers.map((peer) =>
				peer.cursor ? (
					<div
						key={peer.connectionId}
						data-collaborator={peer.userId}
						className="studio-cursor"
						style={{
							transform: `translate(${peer.cursor.x * zoom + x}px, ${peer.cursor.y * zoom + y}px)`,
							color: collaboratorColor(peer.userId),
						}}
					>
						<svg width="20" height="24" viewBox="0 0 20 24" fill="currentColor">
							<title>{peer.name}</title>
							<path
								d="M2 2L18 14L10 15L6 22Z"
								stroke="var(--background)"
								strokeWidth="1.5"
							/>
						</svg>
						<span className="studio-cursor-label">{peer.name}</span>
					</div>
				) : null,
			)}
		</div>
	);
}
function initials(name: string) {
	return (
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0])
			.join("")
			.toUpperCase() || "?"
	);
}
