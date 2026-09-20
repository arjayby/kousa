import type { GenerationStore } from "@kousa/db/generation-store";
import type { GraphStore } from "@kousa/db/graph-store";
import { resolveInputs } from "./freshness";
import {
	buildImagePrompt,
	buildPrompt,
	buildSpeechScript,
	buildVideoPrompt,
	GenerationError,
} from "./input";
import type { createGenerationRunner } from "./runner";
import { type DurableSteps, executeGenerationWorkflow } from "./workflow";

const databaseRetry = {
	retries: { limit: 5, delay: 2_000, backoff: "exponential" as const },
	timeout: 60_000,
};

export async function executeGraphWorkflow(
	id: string,
	store: GraphStore,
	generations: GenerationStore,
	runner: ReturnType<typeof createGenerationRunner>,
	step: DurableSteps,
) {
	const flow = await store.get(id);
	if (flow?.status !== "running") return;
	try {
		if (flow.cancelRequestedAt) {
			// Recover only the request already submitted before cancellation. Never
			// queue a future step, even if the original workflow checkpoints were lost.
			for (const [index, item] of flow.plan.entries()) {
				const child = await generations.get(item.runId);
				if (child?.graphRunId !== id || child.status !== "running") continue;
				await executeGenerationWorkflow(item.runId, runner, {
					do: (name, options, callback) =>
						step.do(`node-${index}-${name}`, options, callback),
					sleep: (name, duration) =>
						step.sleep(`node-${index}-${name}`, duration),
				});
			}
			await step.do("settle-cancelled-workflow", databaseRetry, () =>
				store.finish(id),
			);
			return;
		}
		for (const [index, item] of flow.plan.entries()) {
			const existing = await generations.get(item.runId);
			if (existing?.status === "succeeded") continue;
			if (existing?.status === "failed")
				throw new GenerationError(
					"BAD_REQUEST",
					existing.error ?? "A workflow step failed.",
				);
			const prepared = await step.do(
				`queue-node-${index}`,
				databaseRetry,
				async () => {
					const dependencies = flow.plan.filter((source) =>
						item.sources.some(
							(dependency) =>
								!dependency.runId && dependency.id === source.nodeId,
						),
					);
					const outputs = await store.results([
						...dependencies.map((source) => source.runId),
						...item.sources.flatMap((source) =>
							source.runId ? [source.runId] : [],
						),
					]);
					if (
						outputs.length !==
							dependencies.length +
								item.sources.filter((source) => source.runId).length ||
						outputs.some(
							(output) => output.status !== "succeeded" || !output.output,
						)
					)
						throw new GenerationError(
							"BAD_REQUEST",
							"An upstream step has not completed.",
						);
					const prompt =
						item.kind === "speech"
							? buildSpeechScript(item, outputs)
							: item.kind === "video"
								? buildVideoPrompt(item, outputs)
								: item.kind === "image"
									? buildImagePrompt(item, outputs)
									: buildPrompt(item, outputs);
					const imageRunId =
						(item.kind === "video" || item.kind === "image") && item.image
							? (item.image.runId ??
								flow.plan.find((source) => source.nodeId === item.image?.nodeId)
									?.runId)
							: undefined;
					const image = imageRunId ? await generations.get(imageRunId) : null;
					return store.begin(
						id,
						index,
						prompt,
						resolveInputs(item, outputs, image),
					);
				},
			);
			if (!prepared)
				throw new GenerationError(
					"FORBIDDEN",
					"The workflow stopped because access changed or the run expired.",
				);
			await executeGenerationWorkflow(item.runId, runner, {
				do: (name, options, callback) =>
					step.do(`node-${index}-${name}`, options, callback),
				sleep: (name, duration) =>
					step.sleep(`node-${index}-${name}`, duration),
			});
			const result = await generations.get(item.runId);
			if (result?.status !== "succeeded")
				throw new GenerationError(
					"BAD_REQUEST",
					result?.error ??
						"A workflow step failed. Unfinished credits were released.",
				);
		}
		await step.do("complete-workflow", databaseRetry, () => store.finish(id));
	} catch (error) {
		await step.do("stop-workflow", databaseRetry, () =>
			store.finish(
				id,
				error instanceof GenerationError
					? error.message
					: "The workflow was interrupted. Resume to continue unfinished steps.",
			),
		);
	}
}
