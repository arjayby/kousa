import { createAuth } from "@kousa/auth";
import { createBilling } from "@kousa/billing/runtime";
import { createProjects } from "@kousa/projects/runtime";
import { buttonVariants } from "@kousa/ui/components/button";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProjectListPanel } from "@/components/projects/project-list";
import Dashboard from "./dashboard";

export default async function DashboardPage() {
	const session = await createAuth().api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/login");
	}

	const [{ balance }, projects] = await Promise.all([
		createBilling().summary(session.user.id),
		createProjects().list(session.user.id),
	]);

	return (
		<div className="container mx-auto flex flex-col gap-6 px-4 py-8">
			<div>
				<h1 className="font-semibold text-2xl">Projects</h1>
				<p className="text-muted-foreground">Welcome {session.user.name}</p>
				<Link
					href="/playground"
					className={buttonVariants({ variant: "outline" })}
				>
					Open Playground
				</Link>
			</div>
			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<ProjectListPanel userId={session.user.id} initialProjects={projects} />
				<Dashboard userId={session.user.id} initialBalance={balance} />
			</div>
		</div>
	);
}
