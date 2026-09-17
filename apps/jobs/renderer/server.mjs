import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { renderClip } from "./render.mjs";

try {
	for (const command of ["ffmpeg", "ffprobe"])
		execFileSync(command, ["-version"], { stdio: "ignore", timeout: 5000 });
} catch {
	console.error(
		"Clip renderer needs FFmpeg and ffprobe on PATH. On macOS: brew install ffmpeg",
	);
	process.exit(1);
}
let busy = false;
const maxBytes = 31 * 1024 * 1024;
createServer(async (req, res) => {
	if (req.method === "GET" && req.url === "/health") {
		res.writeHead(200);
		res.end("ok");
		return;
	}
	if (req.method !== "POST" || req.url !== "/render" || req.headers.origin) {
		res.writeHead(404);
		res.end();
		return;
	}
	if (busy) {
		res.writeHead(503);
		res.end("Renderer busy");
		return;
	}
	busy = true;
	try {
		let size = 0;
		const chunks = [];
		for await (const chunk of req) {
			size += chunk.length;
			if (size > maxBytes) throw new Error("Request too large");
			chunks.push(chunk);
		}
		const request = new Request("http://renderer/render", {
			method: "POST",
			headers: { "content-type": req.headers["content-type"] ?? "" },
			body: Buffer.concat(chunks),
		});
		const form = await request.formData();
		const video = form.get("video");
		const audio = form.get("audio");
		if (!(video instanceof Blob) || !(audio instanceof Blob))
			throw new Error("Missing media");
		const result = await renderClip(
			new Uint8Array(await video.arrayBuffer()),
			new Uint8Array(await audio.arrayBuffer()),
			JSON.parse(String(form.get("settings"))),
		);
		res.writeHead(200, {
			"Content-Type": "video/mp4",
			"Content-Length": result.length,
		});
		res.end(result);
	} catch {
		res.writeHead(422);
		res.end("Clip rendering failed");
	} finally {
		busy = false;
	}
}).listen(
	Number(process.env.PORT ?? 8790),
	process.env.RENDER_HOST ?? "127.0.0.1",
	() => console.log("Kousa clip renderer ready"),
);
