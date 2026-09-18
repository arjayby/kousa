import { createAuth } from "@kousa/auth";
import { createPlayground } from "@kousa/generation/playground-runtime";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Playground } from "@/components/playground/playground";

export const metadata = { title: "Playground | Kousa" };
export default async function PlaygroundPage() {
	const session = await createAuth().api.getSession({
		headers: await headers(),
	});
	if (!session?.user) redirect("/login");
	const initial = await createPlayground().history(session.user.id);
	return (
		<Playground
			key={session.user.id}
			userId={session.user.id}
			initial={initial}
		/>
	);
}
