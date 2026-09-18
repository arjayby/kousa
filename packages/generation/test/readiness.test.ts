import { describe, expect, it } from "vitest";
import { generationBlockReason } from "../src/readiness";

const ready = {
	canRun: true,
	loading: false,
	queryError: false,
	configured: true,
	pendingNode: false,
	checking: false,
	pending: false,
	myRunActive: false,
	uncertain: false,
	balance: 5,
	cost: 3,
	empty: false,
	inputError: null,
};
describe("generation preflight guidance", () => {
	it("allows a ready node, and preserves the specific shared input validation error", () => {
		expect(generationBlockReason(ready)).toBeNull();
		expect(
			generationBlockReason({
				...ready,
				inputError: "Upload or generate the starting image first.",
			}),
		).toBe("Upload or generate the starting image first.");
	});
	it("explains empty input, credits, availability, connectivity, and status refresh", () => {
		expect(generationBlockReason({ ...ready, empty: true })).toContain(
			"Add a prompt",
		);
		expect(generationBlockReason({ ...ready, balance: 2 })).toContain(
			"needs 3 credits",
		);
		expect(generationBlockReason({ ...ready, configured: false })).toContain(
			"unavailable",
		);
		expect(generationBlockReason({ ...ready, canRun: false })).toContain(
			"Retry connection",
		);
		expect(generationBlockReason({ ...ready, queryError: true })).toContain(
			"Refresh generation status",
		);
	});
	it("allows checking an uncertain request even if the balance or input changed, but still requires connectivity", () => {
		const checking = {
			...ready,
			checking: true,
			uncertain: true,
			pending: true,
			balance: 0,
			empty: true,
			inputError: "Changed",
		};
		expect(generationBlockReason(checking)).toBeNull();
		expect(generationBlockReason({ ...checking, canRun: false })).toContain(
			"connect",
		);
		expect(generationBlockReason({ ...checking, pendingNode: true })).toContain(
			"Confirming",
		);
	});
	it("directs users to the existing request rather than suggesting another paid run", () => {
		expect(generationBlockReason({ ...ready, uncertain: true })).toContain(
			"Check run",
		);
		expect(generationBlockReason({ ...ready, myRunActive: true })).toContain(
			"Open Runs",
		);
	});
});
