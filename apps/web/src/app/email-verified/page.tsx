import Link from "next/link";

export default async function EmailVerifiedPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = await searchParams;
	return (
		<main className="container mx-auto flex flex-col gap-4 px-4 py-8">
			<h1 className="font-semibold text-2xl">
				{error ? "Email verification failed" : "Email verification complete"}
			</h1>
			<p>
				{error
					? "This verification link is invalid or expired. Return to your invitation and request a new email."
					: "Return to your project invitation and choose I've verified my email to continue."}
			</p>
			<Link href="/dashboard" className="underline">
				Back to projects
			</Link>
		</main>
	);
}
