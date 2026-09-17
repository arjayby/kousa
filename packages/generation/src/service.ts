import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { ProjectService } from "@kousa/projects/service";
import {
	generateInput,
	listGenerationsInput,
	type PublicRun,
	textCreditCost,
	textModels,
} from "./contracts";
import {
	buildPrompt,
	GenerationError,
	textInputHash,
	textInputSnapshot,
} from "./input";

export interface TextProvider {
	configured: boolean;
	generate(input: { modelId: string; prompt: string }): Promise<{
		output: string;
		inputTokens: number | null;
		outputTokens: number | null;
	}>;
}
function publicRun(run: GenerationRun): PublicRun {
	return {
		id: run.id,
		nodeId: run.nodeId,
		userId: run.userId,
		modelId: run.modelId,
		status: run.status,
		output: run.output,
		error: run.error,
		credits: run.credits,
		createdAt: run.createdAt.toISOString(),
		inputHash: run.inputHash,
	};
}

export function createGenerationService(
	store: GenerationStore,
	projects: Pick<ProjectService, "get" | "getCanvas">,
	provider: TextProvider,
) {
	async function getOwnedRun(
		actorId: string,
		input: { id: string; projectId: string; nodeId: string },
	) {
		const run = await store.get(input.id);
		if (
			run &&
			(run.userId !== actorId ||
				run.projectId !== input.projectId ||
				run.nodeId !== input.nodeId)
		)
			throw new GenerationError(
				"CONFLICT",
				"This request ID has already been used.",
			);
		return run;
	}
	return {
		async list(actorId: string, raw: unknown) {
			const { projectId, nodeIds } = listGenerationsInput.parse(raw);
			await projects.get(actorId, { projectId });
			await store.expire(projectId);
			const [runs, balance] = await Promise.all([
				store.latest(projectId, nodeIds),
				store.balance(actorId),
			]);
			return {
				runs: runs.map(publicRun),
				balance,
				configured: provider.configured,
			};
		},
		async generate(actorId: string, raw: unknown) {
			const input = generateInput.parse(raw);
			const access = await projects.get(actorId, input);
			if (!access.permissions.canEdit)
				throw new GenerationError(
					"FORBIDDEN",
					"Only owners and editors can generate.",
				);
			await store.expire(input.projectId);
			const previous = await getOwnedRun(actorId, input);
			if (previous) return publicRun(previous);
			if (!provider.configured)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"AI generation is not configured yet.",
				);
			const { document } = await projects.getCanvas(actorId, input);
			if ((await textInputHash(document, input.nodeId)) !== input.inputHash)
				throw new GenerationError(
					"CONFLICT",
					"The shared prompt changed or is still saving. Wait for it to sync, then try again.",
				);
			const snapshot = textInputSnapshot(document, input.nodeId);
			if (!textModels.some((model) => model.id === snapshot.modelId))
				throw new GenerationError(
					"BAD_REQUEST",
					"Choose an available text model.",
				);
			const outputs = await store.outputs(
				input.projectId,
				snapshot.sources.map((s) => s.id),
			);
			const prompt = buildPrompt(snapshot, outputs);
			const claim = await store.claim({
				...input,
				userId: actorId,
				modelId: snapshot.modelId,
				prompt,
				credits: textCreditCost,
			});
			if (claim.error) {
				if (claim.error === "NO_CREDITS")
					throw new GenerationError(
						"PAYMENT_REQUIRED",
						"You need 1 credit to generate text.",
					);
				if (claim.error === "FORBIDDEN")
					throw new GenerationError(
						"FORBIDDEN",
						"Your editing access changed. Refresh this project.",
					);
				throw new GenerationError(
					"CONFLICT",
					claim.error === "BUSY"
						? "A generation is already running for you or this node. Wait for it to finish."
						: "This request ID has already been used.",
				);
			}
			if (!claim.claimed) {
				const run = await getOwnedRun(actorId, input);
				if (!run)
					throw new GenerationError(
						"SERVICE_UNAVAILABLE",
						"Could not load the existing run.",
					);
				return publicRun(run);
			}
			let result: Awaited<ReturnType<TextProvider["generate"]>>;
			try {
				result = await provider.generate({ modelId: snapshot.modelId, prompt });
				if (!result.output.trim() || result.output.length > 50_000)
					throw new Error("Invalid model output");
			} catch {
				// Provider errors may contain credentials or prompts. Store only this safe message.
				const failed = await store.finish(input.id, {
					error:
						"Generation failed or timed out. Your credit was released. Try again.",
				});
				const run = failed ?? (await store.get(input.id));
				if (!run)
					throw new GenerationError(
						"SERVICE_UNAVAILABLE",
						"Could not load the run. Refresh to check its status.",
					);
				return publicRun(run);
			}
			// Output and debit become final in the same atomic update. A database failure
			// must not be mistaken for a provider failure or cause a second provider call.
			const finished = await store.finish(input.id, result);
			await store.expire(input.projectId);
			const run = finished ?? (await store.get(input.id));
			if (!run)
				throw new GenerationError(
					"SERVICE_UNAVAILABLE",
					"Could not load the run. Refresh to check its status.",
				);
			return publicRun(run);
		},
	};
}
export type GenerationService = ReturnType<typeof createGenerationService>;
