import type {
	CanvasChatRow,
	CanvasChatStore,
} from "@kousa/db/canvas-chat-store";
import type { ProjectService } from "@kousa/projects/service";
import {
	type ChatProposal,
	chatPrompt,
	chatRequest,
	chatScope,
	insertChatProposal,
	parseChatPlan,
} from "./canvas-chat";
import { defaultTextModel } from "./contracts";
import { GenerationError } from "./input";
import type { TextProvider } from "./providers";

function publicReply(row: CanvasChatRow) {
	return {
		id: row.id,
		message: row.message,
		previousId: row.previousId,
		status: row.status,
		proposal: row.proposal as ChatProposal | null,
		error: row.error,
		createdAt: row.createdAt.toISOString(),
	};
}
export type ChatReply = ReturnType<typeof publicReply>;

export function createCanvasChatService(
	store: CanvasChatStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	provider: TextProvider,
) {
	async function authorize(
		actorId: string,
		input: { projectId: string; canvasId: string },
	) {
		const access = await projects.get(actorId, input);
		if (!access.permissions.canEdit)
			throw new GenerationError(
				"FORBIDDEN",
				"Only owners and editors can compose workflows.",
			);
		return projects.getCanvas(actorId, input);
	}
	async function owned(
		actorId: string,
		input: { projectId: string; canvasId: string },
		id: string,
	) {
		const row = await store.get(id);
		if (
			!row ||
			row.userId !== actorId ||
			row.projectId !== input.projectId ||
			row.canvasId !== input.canvasId
		)
			throw new GenerationError("NOT_FOUND", "Chat reply not found.");
		return row;
	}
	return {
		async history(actorId: string, raw: unknown) {
			const input = chatScope.parse(raw);
			await authorize(actorId, input);
			await store.expire(actorId);
			return {
				configured: provider.configured,
				replies: (await store.history(actorId, input.canvasId))
					.reverse()
					.map(publicReply),
			};
		},
		async compose(actorId: string, raw: unknown) {
			const input = chatRequest.parse(raw);
			const { document } = await authorize(actorId, input);
			await store.expire(actorId);
			const existing = await store.get(input.id);
			if (existing) {
				const row = await owned(actorId, input, input.id);
				if (
					row.message !== input.message ||
					row.previousId !== input.previousId
				)
					throw new GenerationError(
						"CONFLICT",
						"This request ID has already been used.",
					);
				return publicReply(row);
			}
			if (!provider.configured)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"Canvas chat is not configured yet.",
				);
			const previous = input.previousId
				? await owned(actorId, input, input.previousId)
				: null;
			if (previous && (previous.status !== "succeeded" || !previous.proposal))
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose a completed reply to refine.",
				);
			const claim = await store.claim({ ...input, userId: actorId });
			if (claim.error)
				throw new GenerationError(
					claim.error === "FORBIDDEN" ? "FORBIDDEN" : "CONFLICT",
					{
						FORBIDDEN: "Your editing access changed.",
						CONFLICT: "This request ID has already been used.",
						BUSY: "Wait for your current chat reply to finish.",
						LIMIT:
							"You've reached 20 chat requests this hour. Please try again later.",
					}[claim.error],
				);
			if (claim.claimed) {
				try {
					const response = await provider.generate({
						modelId: defaultTextModel,
						prompt: chatPrompt(
							input.message,
							previous
								? {
										message: previous.message,
										proposal: previous.proposal as ChatProposal,
									}
								: null,
						),
					});
					const proposal = await parseChatPlan(response.output);
					if (proposal.graph.nodes.length)
						insertChatProposal(document, proposal);
					await authorize(actorId, input);
					await store.finish(input.id, { proposal });
				} catch {
					await store.finish(input.id, {
						error:
							"I couldn't make a valid workflow from that request. Try a smaller workflow or describe the result more clearly. No credits were used.",
					});
				}
			}
			await authorize(actorId, input);
			return publicReply(await owned(actorId, input, input.id));
		},
	};
}
export type CanvasChatService = ReturnType<typeof createCanvasChatService>;
