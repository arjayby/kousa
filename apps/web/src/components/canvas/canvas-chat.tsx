"use client";

import type { ChatProposal } from "@kousa/generation/canvas-chat";
import type { ChatReply } from "@kousa/generation/canvas-chat-service";
import { type CanvasDocument, nodeLabels } from "@kousa/projects/canvas";
import { Alert, AlertDescription } from "@kousa/ui/components/alert";
import { Bubble, BubbleContent } from "@kousa/ui/components/bubble";
import { Button } from "@kousa/ui/components/button";
import { Field, FieldLabel } from "@kousa/ui/components/field";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "@kousa/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@kousa/ui/components/message-scroller";
import { Textarea } from "@kousa/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { client, orpc } from "@/utils/orpc";
import type { Workflow } from "./canvas-workflow";

type Request = Parameters<typeof client.canvasChat.compose>[0];
const examples = [
	"Write an ad direction for a premium matcha drink, then create a square product image from it.",
	"Create a 5-second vertical video of a perfume bottle on a beach, starting from a generated image.",
];

function Proposal({
	proposal,
	graph,
	canEdit,
	workflow,
	insert,
	refine,
}: {
	proposal: ChatProposal;
	graph: CanvasDocument;
	canEdit: boolean;
	workflow: Workflow;
	insert: (proposal: ChatProposal) => string | null;
	refine: () => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const present = proposal.graph.nodes.filter((node) =>
		graph.nodes.some((current) => current.id === node.id),
	).length;
	const complete = present === proposal.graph.nodes.length;
	return (
		<div className="space-y-3 border bg-card p-3 text-xs">
			<p className="font-medium">
				{proposal.graph.nodes.length}{" "}
				{proposal.graph.nodes.length === 1 ? "node" : "nodes"} ·{" "}
				{proposal.graph.edges.length}{" "}
				{proposal.graph.edges.length === 1 ? "connection" : "connections"}
			</p>
			<ol className="space-y-3">
				{proposal.graph.nodes.map((node) => (
					<li key={node.id} className="space-y-1">
						<p className="font-medium">
							{nodeLabels[node.type]} · {node.data.label}
						</p>
						{node.type === "image" || node.type === "video" ? (
							<p className="text-muted-foreground">
								{node.data.aspectRatio}
								{node.type === "video"
									? ` · ${node.data.duration} seconds`
									: ""}
							</p>
						) : null}
						<p className="whitespace-pre-wrap text-muted-foreground">
							{node.data.content || "Uses the connected script."}
						</p>
					</li>
				))}
			</ol>
			{proposal.graph.edges.length ? (
				<ul
					className="space-y-1 border-t pt-2 text-muted-foreground"
					aria-label="Proposed connections"
				>
					{proposal.graph.edges.map((edge) => (
						<li key={edge.id}>
							{
								proposal.graph.nodes.find((n) => n.id === edge.source)?.data
									.label
							}{" "}
							→{" "}
							{
								proposal.graph.nodes.find((n) => n.id === edge.target)?.data
									.label
							}{" "}
							· {edge.targetHandle}
						</li>
					))}
				</ul>
			) : null}
			<p>Initial generation estimate: {proposal.credits} credits</p>
			<div className="flex flex-wrap gap-2">
				{complete ? (
					<Button
						size="sm"
						disabled={!workflow.canRun || workflow.pending || !!workflow.active}
						onClick={async () => {
							setError(null);
							if (!(await workflow.review(proposal.targetIds)))
								setError(
									"Could not review this workflow. Check the workflow message and try again.",
								);
						}}
					>
						Review generation
					</Button>
				) : (
					<Button
						size="sm"
						disabled={!canEdit || present > 0}
						onClick={() => setError(insert(proposal))}
					>
						<PlusIcon data-icon="inline-start" />
						Add to canvas
					</Button>
				)}
				<Button
					size="sm"
					variant="outline"
					disabled={!canEdit}
					onClick={refine}
				>
					Refine proposal
				</Button>
			</div>
			{complete ? (
				<p className="text-muted-foreground">
					Added to canvas. You can edit the nodes or undo the insertion.
				</p>
			) : present > 0 ? (
				<p className="text-muted-foreground">
					Some nodes from this proposal are already on the canvas. Use Undo to
					restore the full insertion.
				</p>
			) : (
				<p className="text-muted-foreground">
					Adding is free. Review the final cost before generating.
				</p>
			)}
			{error ? (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

export function CanvasChat({
	userId,
	projectId,
	canvasId,
	graph,
	canEdit,
	canRun,
	workflow,
	insert,
	close,
}: {
	userId: string;
	projectId: string;
	canvasId: string;
	graph: CanvasDocument;
	canEdit: boolean;
	canRun: boolean;
	workflow: Workflow;
	insert: (proposal: ChatProposal) => string | null;
	close: () => void;
}) {
	const cache = useQueryClient();
	const queryKey = ["canvas-chat", userId, projectId, canvasId];
	const [draft, setDraft] = useState("");
	const [parent, setParent] = useState<string | null | undefined>(undefined);
	const [pending, setPending] = useState<Request | null>(null);
	const [retry, setRetry] = useState<Request | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const input = useRef<HTMLTextAreaElement>(null);
	const query = useQuery({
		...orpc.canvasChat.history.queryOptions({ input: { projectId, canvasId } }),
		queryKey,
		enabled: canEdit,
		retry: false,
		refetchInterval: (query) =>
			pending ||
			query.state.data?.replies.some((reply) => reply.status === "running")
				? 2000
				: false,
	});
	const replies = query.data?.replies ?? [];
	const latest = replies.findLast((reply) => reply.status === "succeeded");
	const previousId =
		parent === undefined
			? latest &&
				!latest.proposal?.graph.nodes.some((node) =>
					graph.nodes.some((current) => current.id === node.id),
				)
				? latest.id
				: null
			: parent;
	const previous = replies.find((reply) => reply.id === previousId);
	const remoteBusy = replies.some((reply) => reply.status === "running");
	const disabled =
		!canRun || !query.data?.configured || !!pending || remoteBusy || !!retry;
	const displayed: ChatReply[] =
		pending && !replies.some((reply) => reply.id === pending.id)
			? [
					...replies,
					{
						...pending,
						previousId: pending.previousId ?? null,
						status: "running",
						proposal: null,
						error: null,
						createdAt: new Date().toISOString(),
					},
				]
			: replies;

	async function send(request: Request) {
		if (busy.current || !canRun) return;
		busy.current = true;
		setPending(request);
		setError(null);
		setRetry(null);
		try {
			const reply = await client.canvasChat.compose(request);
			cache.setQueryData<Awaited<ReturnType<typeof client.canvasChat.history>>>(
				queryKey,
				(data) => ({
					configured: data?.configured ?? true,
					replies: [
						...(data?.replies ?? []).filter((item) => item.id !== reply.id),
						reply,
					].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
				}),
			);
			setDraft("");
			setParent(undefined);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not confirm the reply. Retry to recover this request.",
			);
			setRetry(request);
		} finally {
			busy.current = false;
			setPending(null);
			void query.refetch();
		}
	}
	function refine(id: string) {
		setParent(id);
		setDraft("");
		input.current?.focus();
	}
	return (
		<aside className="studio-chat" aria-label="Canvas chat">
			<header className="flex items-center justify-between gap-2 border-b p-3">
				<div className="flex items-center gap-2">
					<MessageSquareIcon className="size-4" />
					<h2 className="font-medium text-sm">Canvas chat</h2>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close canvas chat"
					onClick={close}
				>
					<XIcon />
				</Button>
			</header>
			<MessageScrollerProvider autoScroll>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent className="gap-5 p-3">
							{query.isPending ? (
								<p role="status" className="text-muted-foreground text-xs">
									Loading your chat…
								</p>
							) : null}
							{!displayed.length ? (
								<div className="space-y-3 text-xs">
									<p className="font-medium text-sm">
										Describe it. Build it on the canvas.
									</p>
									<p className="text-muted-foreground">
										Create connected text, image, video, and audio nodes. Refine
										the proposal here, then add it to your canvas.
									</p>
									{examples.map((example) => (
										<Button
											key={example}
											variant="outline"
											className="h-auto w-full justify-start whitespace-normal p-3 text-left text-xs"
											disabled={disabled}
											onClick={() => {
												setParent(null);
												setDraft(example);
												input.current?.focus();
											}}
										>
											{example}
										</Button>
									))}
								</div>
							) : null}
							{displayed.map((reply) => (
								<MessageScrollerItem
									key={reply.id}
									messageId={reply.id}
									scrollAnchor
								>
									<div className="space-y-3">
										<Message align="end">
											<MessageContent>
												<MessageHeader>
													You{reply.previousId ? " · follow-up" : ""}
												</MessageHeader>
												<Bubble align="end">
													<BubbleContent className="whitespace-pre-wrap">
														{reply.message}
													</BubbleContent>
												</Bubble>
											</MessageContent>
										</Message>
										<Message>
											<MessageContent>
												<MessageHeader>Kousa</MessageHeader>
												{reply.status === "running" ? (
													<p
														role="status"
														className="flex items-center gap-2 text-muted-foreground"
													>
														<LoaderCircleIcon className="size-3 animate-spin" />
														Composing your workflow…
													</p>
												) : (
													<Bubble
														variant={
															reply.status === "failed"
																? "destructive"
																: "ghost"
														}
														className="max-w-full"
													>
														<BubbleContent className="whitespace-pre-wrap">
															{reply.error ?? reply.proposal?.message}
														</BubbleContent>
													</Bubble>
												)}
												{reply.proposal?.graph.nodes.length ? (
													<Proposal
														proposal={reply.proposal}
														graph={graph}
														canEdit={canEdit}
														workflow={workflow}
														insert={insert}
														refine={() => refine(reply.id)}
													/>
												) : null}
											</MessageContent>
										</Message>
									</div>
								</MessageScrollerItem>
							))}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<form
				className="space-y-2 border-t p-3"
				onSubmit={(event) => {
					event.preventDefault();
					if (!disabled && draft.trim())
						void send({
							id: crypto.randomUUID(),
							projectId,
							canvasId,
							message: draft.trim(),
							previousId,
						});
				}}
			>
				{error || query.error ? (
					<Alert variant="destructive">
						<AlertDescription>{error ?? query.error?.message}</AlertDescription>
					</Alert>
				) : null}
				{retry ? (
					<div className="flex gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={!!pending || !canRun}
							onClick={() => void send(retry)}
						>
							Retry request
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								setRetry(null);
								setError(null);
							}}
						>
							Dismiss
						</Button>
					</div>
				) : null}
				{previous ? (
					<div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
						<span className="truncate">Refining: {previous.message}</span>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => setParent(null)}
						>
							New idea
						</Button>
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						New workflow · existing nodes stay as they are
					</p>
				)}
				<Field>
					<FieldLabel htmlFor="canvas-chat-message" className="sr-only">
						Describe your workflow
					</FieldLabel>
					<Textarea
						id="canvas-chat-message"
						ref={input}
						value={draft}
						maxLength={2000}
						disabled={!!pending || !canEdit}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={
							previous
								? "What would you like to change?"
								: "Write an ad brief, then turn it into an image…"
						}
						className="max-h-36 min-h-20 resize-none text-xs"
					/>
				</Field>
				<div className="flex items-center justify-between gap-2">
					<p className="text-[10px] text-muted-foreground">
						Free planning · 20 requests/hour
						<br />
						Chat is private. Added nodes are shared.
					</p>
					<Button type="submit" size="sm" disabled={disabled || !draft.trim()}>
						<ArrowUpIcon data-icon="inline-start" />
						Send
					</Button>
				</div>
				{!canRun ? (
					<p className="text-muted-foreground text-xs">
						Waiting for editing access and a fully saved canvas.
					</p>
				) : query.data && !query.data.configured ? (
					<p className="text-muted-foreground text-xs">
						Canvas chat is not configured yet.
					</p>
				) : null}
			</form>
		</aside>
	);
}
