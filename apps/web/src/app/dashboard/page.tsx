import { createAuth } from "@kousa/auth";
import { createBilling } from "@kousa/billing/runtime";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
	const session = await createAuth().api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/login");
	}

	const { balance } = await createBilling().summary(session.user.id);

	return (
		<div className="container mx-auto flex flex-col gap-6 px-4 py-8">
			<div>
				<h1 className="font-semibold text-2xl">Dashboard</h1>
				<p className="text-muted-foreground">Welcome {session.user.name}</p>
			</div>
			<Dashboard userId={session.user.id} initialBalance={balance} />
		</div>
	);
}
