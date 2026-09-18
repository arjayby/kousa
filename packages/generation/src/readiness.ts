/** Explain the first blocking preflight condition without starting a paid run. */
export function generationBlockReason(state: {
	canRun: boolean;
	loading: boolean;
	queryError: boolean;
	configured?: boolean;
	pendingNode: boolean;
	checking: boolean;
	pending: boolean;
	myRunActive: boolean;
	uncertain: boolean;
	balance?: number;
	cost: number;
	empty: boolean;
	inputError: string | null;
}) {
	if (!state.canRun)
		return "Wait for the canvas to connect and finish saving. Use Retry connection if it stays disconnected.";
	if (state.loading) return "Checking your balance and generation status…";
	if (state.queryError)
		return "Could not load generation status. Use Refresh generation status to try again.";
	if (!state.configured)
		return "This generator is unavailable here. Try another example or upload a media file.";
	if (state.pendingNode)
		return "Confirming a generation request. Wait for its status before starting another.";
	if (state.checking) return null;
	if (state.pending)
		return "This node is generating. Its result will be saved here; you can check progress in Runs.";
	if (state.uncertain)
		return "Another run could not be confirmed. Use Check run on that node before starting another.";
	if (state.myRunActive)
		return "You already have a run in progress. Open Runs to check it, then try again when it finishes.";
	if ((state.balance ?? 0) < state.cost)
		return `This run needs ${state.cost} credits; your balance is ${state.balance ?? 0}. Add credits from your dashboard, then refresh generation status.`;
	if (state.inputError) return state.inputError;
	if (state.empty)
		return "Add a prompt or connect a supported input before generating.";
	return null;
}
