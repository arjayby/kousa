import { spawn } from "node:child_process";

const renderer = spawn("node", ["renderer/server.mjs"], { stdio: "inherit" });
renderer.on("error", () =>
	console.error("Start the clip renderer with node renderer/server.mjs."),
);

// Alchemy supplies the managed database URL and API key in the child environment.
// Wrangler's required-secrets allowlist imports only those two into the Worker.
const worker = spawn(
	"pnpm",
	[
		"exec",
		"wrangler",
		"dev",
		"--test-scheduled",
		"--persist-to",
		"../web/.wrangler/state",
	],
	{ stdio: "inherit" },
);
// Recover once the local Worker is ready, then match production's 15-minute scan.
// Polling Neon every minute would prevent its free-plan idle suspension.
async function recover() {
	try {
		const response = await fetch(
			`http://127.0.0.1:8787/__scheduled?cron=${encodeURIComponent("*/15 * * * *")}`,
			{
				signal: AbortSignal.timeout(15_000),
			},
		);
		return response.ok;
	} catch {
		return false;
	}
}
let startupTimer = setTimeout(async function startup() {
	if (!(await recover())) startupTimer = setTimeout(startup, 2_000);
}, 1_000);
const sweep = setInterval(() => {
	void recover();
}, 15 * 60_000);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => {
		worker.kill(signal);
		renderer.kill(signal);
	});
worker.on("exit", (code) => {
	renderer.kill();
	clearInterval(sweep);
	clearTimeout(startupTimer);
	process.exit(code ?? 0);
});
