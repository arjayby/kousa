import { databaseClient } from "@kousa/db/client";
import { createMediaLifecycleStore } from "@kousa/db/media-lifecycle-store";
import { createProjectStore } from "@kousa/db/project-store";
import { createLiveblocksProvider } from "@kousa/projects/collaboration-liveblocks";
import { createMediaLifecycle } from "./lifecycle";
import { r2Storage } from "./storage";

export function mediaLifecycleRuntime(env: {
	DATABASE_URL: string;
	MEDIA: R2Bucket;
	LIVEBLOCKS_SECRET_KEY?: string;
}) {
	const db = databaseClient(env.DATABASE_URL);
	const provider = createLiveblocksProvider(env.LIVEBLOCKS_SECRET_KEY);
	return createMediaLifecycle(
		createMediaLifecycleStore(db),
		createProjectStore(db),
		r2Storage(env.MEDIA),
		async (room) => {
			if (!provider) throw new Error("Shared canvas is unavailable");
			return provider.read(room, true);
		},
	);
}
