import { createDb } from "@kousa/db";
import { createMediaStore } from "@kousa/db/media-store";
import { createProjectStore } from "@kousa/db/project-store";
import { env } from "@kousa/env/server";
import { createMediaService } from "./service";
import { r2Storage } from "./storage";

export function createMedia() {
	const db = createDb();
	return createMediaService(
		createMediaStore(db),
		createProjectStore(db),
		r2Storage(env.MEDIA),
	);
}
