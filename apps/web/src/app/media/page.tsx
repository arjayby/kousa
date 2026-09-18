import { createAuth } from "@kousa/auth";
import { createMediaGallery } from "@kousa/media/gallery";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MediaGallery } from "@/components/media/media-gallery";

export const metadata = { title: "Media | Kousa" };

export default async function MediaPage() {
	const session = await createAuth().api.getSession({
		headers: await headers(),
	});
	if (!session?.user) redirect("/login");
	const initial = await createMediaGallery().list(session.user.id);
	return (
		<MediaGallery
			key={session.user.id}
			userId={session.user.id}
			initial={initial}
		/>
	);
}
