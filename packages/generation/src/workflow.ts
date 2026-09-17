import type { createGenerationRunner, PreparedResult } from "./runner";

// A small adapter keeps orchestration testable without importing cloudflare:workers.
export interface DurableSteps {
	do<T extends PreparedResult | boolean | undefined>(
		name: string,
		options: {
			retries: {
				limit: number;
				delay: number;
				backoff: "constant" | "exponential";
			};
			timeout: number;
		},
		callback: () => Promise<T>,
	): Promise<T>;
}
const storageRetry = {
	retries: { limit: 5, delay: 2_000, backoff: "exponential" as const },
	timeout: 120_000,
};
export async function executeGenerationWorkflow(
	id: string,
	runner: ReturnType<typeof createGenerationRunner>,
	step: DurableSteps,
) {
	try {
		const generated = await step.do(
			"generate-and-store-receipt",
			{
				retries: { limit: 8, delay: 20_000, backoff: "constant" },
				timeout: 120_000,
			},
			() => runner.generate(id),
		);
		if (generated) {
			const prepared = await step.do("prepare-result", storageRetry, () =>
				runner.prepare(id),
			);
			await step.do("publish-and-charge", storageRetry, () =>
				runner.finalize(id, prepared),
			);
		}
	} catch {
		// A commit may have succeeded before the transport failed. The conditional
		// failure update never refunds an already successful run.
		await step.do("release-failed-reservation", storageRetry, () =>
			runner.fail(id),
		);
	}
	await step.do("remove-receipt", storageRetry, () => runner.cleanup(id));
	return { runId: id };
}
