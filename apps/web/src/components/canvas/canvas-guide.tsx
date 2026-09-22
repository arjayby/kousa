"use client";

import {
	type createCanvasStarter,
	type StarterCapabilities,
	type StarterKind,
	starterExamples,
	starterKinds,
	starterUnavailable,
} from "@kousa/generation/starters";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kousa/ui/components/dialog";
import { BookOpenIcon } from "lucide-react";
import { useContext, useRef } from "react";
import { GenerationContext } from "./canvas-generation";

export type StarterSession = ReturnType<typeof createCanvasStarter>;
const shortcuts = [
	["Search nodes", "⌘/Ctrl K"],
	["Open this guide", "?"],
	["Select all nodes", "⌘/Ctrl A"],
	["Copy / paste nodes or paste media", "⌘/Ctrl C / V"],
	["Duplicate selected nodes", "⌘/Ctrl D"],
	["Undo / redo", "⌘/Ctrl Z / Shift Z"],
	["Delete selection", "Delete / Backspace"],
	["Clear selection / close dialog", "Esc"],
	["Move between controls", "Tab / Shift Tab"],
	["Select focused node", "Enter / Space"],
];
export function CanvasGuide({
	open,
	onOpenChange,
	canEdit,
	remaining,
	capabilities,
	onStarter,
}: {
	open: boolean;
	onOpenChange: (value: boolean) => void;
	canEdit: boolean;
	remaining: number;
	capabilities: StarterCapabilities;
	onStarter: (kind: StarterKind) => boolean;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger
				ref={trigger}
				render={<Button variant="ghost" />}
				title="Canvas guide · ?"
				aria-keyshortcuts="?"
			>
				<BookOpenIcon data-icon="inline-start" /> Guide <kbd>?</kbd>
			</DialogTrigger>
			<DialogContent
				className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
				finalFocus={trigger}
			>
				<DialogHeader>
					<DialogTitle>Build your first workflow</DialogTitle>
					<DialogDescription>
						Choose an example, review its inputs, then generate when you are
						ready. Adding an example spends no credits.
					</DialogDescription>
				</DialogHeader>
				<section
					aria-label="Starter examples"
					className="grid gap-3 sm:grid-cols-2"
				>
					{starterKinds.map((kind) => {
						const example = starterExamples[kind];
						const reason = !canEdit
							? "Examples need editing access and a loaded canvas."
							: remaining < (kind === "image-video" ? 3 : 2)
								? "Remove nodes to make room for this example."
								: starterUnavailable(kind, capabilities);
						return (
							<section
								key={kind}
								className="flex flex-col gap-2 border p-3"
								aria-label={example.title}
							>
								<h3 className="font-medium">{example.title}</h3>
								<p className="text-muted-foreground">{example.description}</p>
								{reason ? (
									<p
										id={`starter-${kind}-reason`}
										className="text-muted-foreground"
									>
										{reason}
									</p>
								) : null}
								<Button
									variant="outline"
									className="mt-auto"
									disabled={!!reason}
									aria-describedby={
										reason ? `starter-${kind}-reason` : undefined
									}
									onClick={() => {
										if (onStarter(kind)) onOpenChange(false);
									}}
								>
									Add {example.title.toLowerCase()} example
								</Button>
							</section>
						);
					})}
				</section>
				<section aria-label="Workflow basics" className="flex flex-col gap-2">
					<h3 className="font-medium">Before you generate</h3>
					<ol className="list-decimal pl-5">
						<li>Select a node to edit its prompt and model.</li>
						<li>
							Use Connections in its settings to preview inputs and selected
							output versions. Text generation only consumes text context.
						</li>
						<li>
							Check the cost and any input messages. Generate uses existing
							inputs; Run affected steps reviews and updates upstream steps too.
						</li>
					</ol>
					<p>
						Some video models include audio. Audio → Video Audio is composition:
						generate or upload both files, then open Clip with audio. It does
						not send audio to the video model.
					</p>
				</section>
				<section
					aria-label="Media and recovery"
					className="flex flex-col gap-2"
				>
					<h3 className="font-medium">Bring media in and recover</h3>
					<p>
						Use Upload media, drop files onto the canvas, or paste copied files
						while the canvas is focused. Images: PNG/JPEG/WebP, 10 MB, 40
						megapixels. Audio: MP3, 10 MB, 3 minutes. Video: H.264 MP4 with
						optional AAC audio, 20 MB, 12 seconds.
					</p>
					<p>
						Uploads spend no credits. Undo removes added nodes while keeping
						their files in Media library. If interrupted, retry the same file.
						For an uncertain generation, use Check run or Runs before starting
						another.
					</p>
					<p>
						If the canvas disconnects, keep the tab open and use Retry
						connection. Download your changes before reloading if saving has not
						finished.
					</p>
				</section>
				<section
					aria-label="Keyboard shortcuts"
					className="flex flex-col gap-2"
				>
					<h3 className="font-medium">Keyboard and navigation</h3>
					<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
						{shortcuts.map(([label, keys]) => (
							<div key={label} className="contents">
								<dt>{label}</dt>
								<dd>
									<kbd>{keys}</kbd>
								</dd>
							</div>
						))}
					</dl>
					<p>
						Shortcuts leave text editing alone. Use Search nodes to reach
						offscreen nodes; use the viewport buttons to fit all nodes or the
						selection. Drag empty space to select, scroll to pan, and pinch to
						zoom.
					</p>
				</section>
			</DialogContent>
		</Dialog>
	);
}

export function StarterProgress({
	session,
	focus,
	dismiss,
}: {
	session: StarterSession;
	focus: (id: string) => void;
	dismiss: () => void;
}) {
	const generation = useContext(GenerationContext);
	if (
		!generation ||
		!session.document.nodes.every((node) =>
			generation.graph.nodes.some((current) => current.id === node.id),
		)
	)
		return null;
	const next = session.steps.find(
		(step) =>
			!(
				step.kind === "image"
					? generation.imageResults
					: step.kind === "audio"
						? generation.speechResults
						: generation.videoResults
			).get(step.nodeId)?.assetId,
	);
	return (
		<Alert role="status">
			<AlertTitle>
				{next ? `Next: ${next.label}` : "Your example is ready"}
			</AlertTitle>
			<AlertDescription>
				<p>
					{next
						? starterExamples[session.kind].next
						: "Select the result to preview or download it. You can edit the prompt and review the cost before generating another version."}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						onClick={() => focus(session.sourceId)}
					>
						{session.kind === "image-edit"
							? "Choose product photo"
							: "Edit source text"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							focus(
								next?.nodeId ??
									session.steps[session.steps.length - 1]?.nodeId ??
									session.sourceId,
							)
						}
					>
						{next ? `Open ${next.label}` : "View result"}
					</Button>
					<Button size="sm" variant="ghost" onClick={dismiss}>
						Dismiss guidance
					</Button>
				</div>
			</AlertDescription>
		</Alert>
	);
}
