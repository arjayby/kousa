import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { GraphRun, GraphStore } from "@kousa/db/graph-store";
import type { MediaStore } from "@kousa/db/media-store";
import type { ProjectService } from "@kousa/projects/service";
import { graphRunTargetIds } from "./graph-plan";
import { GenerationError } from "./input";
import {
	type RunCredits,
	type RunStep,
	type RunSummary,
	runHistoryInput,
	runReferenceInput,
} from "./run-contracts";

const active = (status: string) => status === "queued" || status === "running";
function credits(total: number, status: string): RunCredits {
	const charged = status === "succeeded" ? total : 0;
	const reserved = active(status) || status === "waiting" ? total : 0;
	return { total, charged, reserved, released: total - charged - reserved };
}
function single(run: GenerationRun, userName: string): RunSummary {
	return {
		id: run.id,
		kind: "generation",
		label: `${run.kind[0]?.toUpperCase()}${run.kind.slice(1)} generation`,
		userId: run.userId,
		userName,
		status:
			active(run.status) && run.cancelRequestedAt ? "stopping" : run.status,
		createdAt: run.createdAt.toISOString(),
		completedAt: run.completedAt?.toISOString() ?? null,
		cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
		error: run.error,
		credits: credits(run.credits, run.status),
		completedSteps: run.status === "succeeded" ? 1 : 0,
		totalSteps: 1,
		targetNodeIds: [run.nodeId],
		resumeOf: null,
		resumed: false,
	};
}
function stepsFor(
	flow: GraphRun,
	results: Map<string, GenerationRun>,
): RunStep[] {
	return flow.plan.map((step) => {
		const run = results.get(step.runId);
		const status =
			run?.status ??
			(flow.cancelRequestedAt
				? "cancelled"
				: flow.status === "failed"
					? "blocked"
					: "waiting");
		return {
			nodeId: step.nodeId,
			runId: run?.id ?? null,
			label: step.label || step.kind,
			kind: step.kind,
			status: run?.cancelRequestedAt && active(status) ? "stopping" : status,
			stage: run?.stage ?? null,
			reused: step.reused,
			credits: credits(step.reused ? 0 : step.credits, status),
			modelId: step.modelId,
			error: run?.error ?? null,
			prompt: run?.prompt ?? null,
			output: run?.output ?? null,
			assetId: run?.assetId ?? null,
			mediaAvailable: false,
		};
	});
}
function workflow(
	flow: GraphRun,
	userName: string,
	resumed: boolean,
	steps: RunStep[],
): RunSummary {
	const targets = graphRunTargetIds(flow);
	return {
		id: flow.id,
		kind: "workflow",
		label: flow.plan
			.filter((s) => targets.includes(s.nodeId))
			.map((s) => s.label || s.kind)
			.join(", "),
		userId: flow.userId,
		userName,
		status:
			flow.status === "running" && flow.cancelRequestedAt
				? "stopping"
				: flow.status,
		createdAt: flow.createdAt.toISOString(),
		completedAt: flow.completedAt?.toISOString() ?? null,
		cancelRequestedAt: flow.cancelRequestedAt?.toISOString() ?? null,
		error: flow.error,
		credits: steps.reduce(
			(sum, step) => ({
				total: sum.total + step.credits.total,
				reserved: sum.reserved + step.credits.reserved,
				charged: sum.charged + step.credits.charged,
				released: sum.released + step.credits.released,
			}),
			{ total: 0, reserved: 0, charged: 0, released: 0 },
		),
		completedSteps: steps.filter((s) => s.status === "succeeded").length,
		totalSteps: steps.length,
		targetNodeIds: targets,
		resumeOf: flow.resumeOf,
		resumed,
	};
}

export function createRunService(
	graphs: GraphStore,
	generations: GenerationStore,
	projects: Pick<ProjectService, "get">,
	media: Pick<MediaStore, "get">,
) {
	async function access(actorId: string, projectId: string, edit = false) {
		const project = await projects.get(actorId, { projectId });
		if (edit && !project.permissions.canEdit)
			throw new GenerationError(
				"FORBIDDEN",
				"Only owners and editors can stop runs.",
			);
	}
	async function refresh(projectId: string) {
		await generations.expire(projectId);
		await graphs.expire(projectId);
	}
	async function detail(actorId: string, raw: unknown) {
		const input = runReferenceInput.parse(raw);
		await access(actorId, input.projectId);
		await refresh(input.projectId);
		let summary: RunSummary;
		let steps: RunStep[];
		if (input.kind === "workflow") {
			const flow = await graphs.get(input.id);
			if (!flow || flow.projectId !== input.projectId)
				throw new GenerationError("NOT_FOUND", "Run is unavailable.");
			const [results, userName, resumed] = await Promise.all([
				generations.getMany(
					input.projectId,
					flow.plan.map((s) => s.runId),
				),
				generations.actorName(flow.userId),
				graphs.hasResume(flow.id),
			]);
			steps = stepsFor(flow, new Map(results.map((r) => [r.id, r])));
			summary = workflow(flow, userName, resumed, steps);
		} else {
			const run = await generations.get(input.id);
			if (!run || run.projectId !== input.projectId)
				throw new GenerationError("NOT_FOUND", "Run is unavailable.");
			summary = single(run, await generations.actorName(run.userId));
			steps = [
				{
					nodeId: run.nodeId,
					runId: run.id,
					label: summary.label,
					kind: run.kind,
					status: summary.status,
					stage: run.stage,
					reused: false,
					credits: summary.credits,
					modelId: run.modelId,
					error: run.error,
					prompt: run.prompt,
					output: run.output,
					assetId: run.assetId,
					mediaAvailable: false,
				},
			];
		}
		await Promise.all(
			steps.map(async (step) => {
				step.mediaAvailable =
					!!step.assetId && !!(await media.get(input.projectId, step.assetId));
			}),
		);
		return { ...summary, steps };
	}
	return {
		detail,
		async history(actorId: string, raw: unknown) {
			const { projectId, limit, cursor } = runHistoryInput.parse(raw);
			await access(actorId, projectId);
			await refresh(projectId);
			const [flows, singles] = await Promise.all([
				graphs.history(projectId, limit, cursor),
				generations.projectHistory(projectId, limit, cursor),
			]);
			const rows = [
				...flows.map((row) => ({ ...row, kind: "workflow" as const })),
				...singles.map((row) => ({ ...row, kind: "generation" as const })),
			].sort(
				(a, b) =>
					b.cursorTime.localeCompare(a.cursorTime) ||
					b.run.id.localeCompare(a.run.id),
			);
			const page = rows.slice(0, limit);
			const results = new Map(
				(
					await generations.getMany(
						projectId,
						page.flatMap((row) =>
							row.kind === "workflow" ? row.run.plan.map((s) => s.runId) : [],
						),
					)
				).map((r) => [r.id, r]),
			);
			const runs = page.map((row) =>
				row.kind === "workflow"
					? workflow(
							row.run,
							row.userName,
							row.resumed,
							stepsFor(row.run, results),
						)
					: single(row.run, row.userName),
			);
			const last = page.at(-1);
			return {
				runs,
				nextCursor:
					rows.length > limit && last
						? { createdAt: last.cursorTime, id: last.run.id }
						: null,
			};
		},
		async cancel(actorId: string, raw: unknown) {
			const input = runReferenceInput.parse(raw);
			await access(actorId, input.projectId, true);
			const result = await (input.kind === "workflow"
				? graphs
				: generations
			).cancel(input.id, input.projectId, actorId);
			if (result !== "OK")
				throw new GenerationError(
					result === "FORBIDDEN"
						? "FORBIDDEN"
						: result === "NOT_FOUND"
							? "NOT_FOUND"
							: "CONFLICT",
					result === "CONFLICT"
						? "Stop the workflow to cancel this step."
						: "Run is unavailable or your editing access changed.",
				);
			return detail(actorId, input);
		},
	};
}
export type RunService = ReturnType<typeof createRunService>;
