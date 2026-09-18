import { createMediaTestDatabase } from "@kousa/db/testing-media";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMediaGalleryService } from "../src/gallery";

describe("generated media gallery", () => {
	let db: Awaited<ReturnType<typeof createMediaTestDatabase>>;
	let gallery: ReturnType<typeof createMediaGalleryService>;
	let projectId: string;
	let otherProjectId: string;
	beforeAll(async () => {
		db = await createMediaTestDatabase();
		gallery = createMediaGalleryService(db.gallery);
	}, 30_000);
	beforeEach(async () => {
		await db.query("delete from generation_run");
		await db.query("delete from clip_run");
		({ projectId, otherProjectId } = await db.reset());
	});
	afterAll(async () => {
		await db.close();
	});

	async function asset(
		options: {
			project?: string | null;
			owner?: string;
			kind?: "image" | "video" | "speech";
			name?: string;
			status?: "ready" | "pending";
			createdAt?: string;
		} = {},
	) {
		const id = crypto.randomUUID();
		const kind = options.kind ?? "image";
		const scope = options.project === undefined ? projectId : options.project;
		await db.query(
			`insert into media_asset (id,project_id,owner_id,sha256,name,mime_type,bytes,width,height,duration_ms,status,created_at)
			values ($1,$2,$3,$4,$5,$6,100,$7,$8,$9,$10,$11)`,
			[
				id,
				scope,
				scope ? null : (options.owner ?? "owner"),
				id.replaceAll("-", "").padEnd(64, "0"),
				options.name ?? `${kind}-${id}`,
				kind === "image"
					? "image/png"
					: kind === "video"
						? "video/mp4"
						: "audio/mpeg",
				kind === "speech" ? null : 100,
				kind === "speech" ? null : 100,
				kind === "image" ? null : 1000,
				options.status ?? "ready",
				options.createdAt ?? new Date().toISOString(),
			],
		);
		return { id, projectId: scope, kind, userId: options.owner ?? "owner" };
	}
	async function generation(
		output: Awaited<ReturnType<typeof asset>>,
		prompt = "Saved script",
	) {
		const id = crypto.randomUUID();
		await db.query(
			`insert into generation_run(id,project_id,canvas_id,user_id,node_id,model_id,prompt,input_hash,status,credits,expires_at,kind,asset_id,completed_at,duration,aspect_ratio)
			values($1,$2,$2,$3,$4,'test-model',$5,'hash','succeeded',1,now()+interval '1 hour',$6,$7,now(),$8,$9)`,
			[
				id,
				output.projectId,
				output.userId,
				crypto.randomUUID(),
				prompt,
				output.kind,
				output.id,
				output.kind === "video" ? 5 : null,
				output.kind === "video" ? "16:9" : null,
			],
		);
	}

	it("includes completed personal, shared project, and clip outputs once per asset", async () => {
		const image = await asset();
		const speech = await asset({
			project: null,
			owner: "viewer",
			kind: "speech",
		});
		const clip = await asset({ kind: "video" });
		await generation(image);
		await generation(image);
		await generation(speech);
		await db.query(
			`insert into clip_run(id,project_id,canvas_id,user_id,node_id,input_hash,plan,status,asset_id,expires_at,completed_at)
			values($1,$2,$2,'owner',$3,'hash','{"transcript":"Clip narration"}','succeeded',$4,now(),now())`,
			[crypto.randomUUID(), projectId, crypto.randomUUID(), clip.id],
		);
		const result = await gallery.list("viewer");
		expect(result.assets).toHaveLength(3);
		expect(new Set(result.assets.map((item) => item.id))).toEqual(
			new Set([image.id, speech.id, clip.id]),
		);
		expect(result.assets.find((item) => item.id === speech.id)).toMatchObject({
			projectId: null,
			projectName: null,
			transcript: "Saved script",
		});
		expect(result.assets.find((item) => item.id === clip.id)).toMatchObject({
			projectName: "Media",
			transcript: "Clip narration",
		});
		for (const item of result.assets) {
			expect(item).not.toHaveProperty("sha256");
			expect(item).not.toHaveProperty("ownerId");
			expect(item).not.toHaveProperty("uploaderId");
		}
	});

	it("excludes uploads, pending files, other accounts and inaccessible projects; rechecks membership", async () => {
		await asset({ name: "Only uploaded" });
		await asset({ status: "pending" });
		const shared = await asset();
		const privateFile = await asset({ project: null });
		const other = await asset({ project: otherProjectId, owner: "outsider" });
		await generation(shared);
		await generation(privateFile);
		await generation(other);
		expect(
			(await gallery.list("viewer")).assets.map((item) => item.id),
		).toEqual([shared.id]);
		expect(
			(await gallery.list("outsider")).assets.map((item) => item.id),
		).toEqual([other.id]);
		expect(
			(await gallery.list("editor")).assets.map((item) => item.id),
		).toEqual([shared.id]);
		expect((await gallery.list("owner")).assets).toHaveLength(2);
		await db.revoke("viewer");
		expect((await gallery.list("viewer")).assets).toEqual([]);
	});

	it("filters all stored results by type, filename and project, treating wildcard characters literally", async () => {
		const image = await asset({ name: "100%_done.png" });
		const speech = await asset({ kind: "speech", name: "Narration.mp3" });
		const video = await asset({ kind: "video", name: "Scene.mp4" });
		await generation(image);
		await generation(speech);
		await generation(video);
		for (const output of [image, speech, video]) {
			expect(
				(await gallery.list("viewer", { kind: output.kind })).assets.map(
					(item) => item.id,
				),
			).toEqual([output.id]);
		}
		expect(
			(await gallery.list("viewer", { search: "NARRATION" })).assets.map(
				(item) => item.id,
			),
		).toEqual([speech.id]);
		expect(
			(await gallery.list("viewer", { search: "Media" })).assets,
		).toHaveLength(3);
		expect(
			(await gallery.list("viewer", { search: "%_" })).assets.map(
				(item) => item.id,
			),
		).toEqual([image.id]);
		expect(
			(await gallery.list("viewer", { search: "missing" })).assets,
		).toEqual([]);
	});

	it("paginates every file with stable timestamp and ID ordering, including microseconds", async () => {
		const outputs = [];
		for (const createdAt of [
			"2026-09-18T01:00:00.123456Z",
			"2026-09-18T01:00:00.123456Z",
			"2026-09-18T01:00:00.123455Z",
			"2026-09-18T01:00:00.123454Z",
		]) {
			const output = await asset({ createdAt });
			await generation(output);
			outputs.push(output);
		}
		const first = await gallery.list("viewer", { limit: 1 });
		const second = await gallery.list("viewer", {
			limit: 1,
			cursor: first.nextCursor ?? undefined,
		});
		const third = await gallery.list("viewer", {
			limit: 1,
			cursor: second.nextCursor ?? undefined,
		});
		const fourth = await gallery.list("viewer", {
			limit: 1,
			cursor: third.nextCursor ?? undefined,
		});
		expect(first.assets[0]?.createdAt).toBe("2026-09-18T01:00:00.123456Z");
		expect(
			[first, second, third, fourth].flatMap((page) =>
				page.assets.map((item) => item.id),
			),
		).toEqual([
			...outputs
				.slice(0, 2)
				.map((item) => item.id)
				.sort()
				.reverse(),
			...outputs.slice(2).map((item) => item.id),
		]);
		expect(fourth.nextCursor).toBeNull();
	});
});
