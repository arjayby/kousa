import { z } from "zod";
import { generationProjectInput } from "./contracts";

export const runReferenceInput = generationProjectInput.extend({
	id: z.uuid(),
	kind: z.enum(["workflow", "generation"]),
});
export const runHistoryInput = generationProjectInput.extend({
	limit: z.number().int().min(1).max(30).default(15),
	cursor: z
		.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
		.optional(),
});
export type RunStatus =
	| "queued"
	| "running"
	| "stopping"
	| "succeeded"
	| "failed"
	| "cancelled";
export type RunCredits = {
	total: number;
	reserved: number;
	charged: number;
	released: number;
};
export type RunSummary = {
	id: string;
	kind: "workflow" | "generation";
	label: string;
	userId: string;
	userName: string;
	status: RunStatus;
	createdAt: string;
	completedAt: string | null;
	cancelRequestedAt: string | null;
	error: string | null;
	credits: RunCredits;
	completedSteps: number;
	totalSteps: number;
	targetNodeIds: string[];
	resumeOf: string | null;
	resumed: boolean;
};
export type RunStep = {
	nodeId: string;
	runId: string | null;
	label: string;
	kind: "text" | "image" | "speech" | "video";
	status: RunStatus | "waiting" | "blocked";
	stage: string | null;
	reused: boolean;
	credits: RunCredits;
	modelId: string;
	error: string | null;
	prompt: string | null;
	output: string | null;
	assetId: string | null;
	mediaAvailable: boolean;
};
export const runStatusLabel: Record<RunStatus | "waiting" | "blocked", string> =
	{
		queued: "Queued",
		running: "Running",
		stopping: "Stopping",
		succeeded: "Complete",
		failed: "Failed",
		cancelled: "Cancelled",
		waiting: "Waiting",
		blocked: "Blocked",
	};
