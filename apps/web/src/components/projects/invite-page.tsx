"use client";

import { inviteTokenInput } from "@kousa/projects/contracts";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import { Skeleton } from "@kousa/ui/components/skeleton";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

export function InvitePage() {
	const session = authClient.useSession();
	const [token, setToken] = useState<string | null>(null);
	const [showSignIn, setShowSignIn] = useState(true);
	useEffect(() => {
		// A URL fragment is not sent to the server in requests or Referer headers.
		const read = () => setToken(window.location.hash.slice(1));
		read();
		window.addEventListener("hashchange", read);
		return () => window.removeEventListener("hashchange", read);
	}, []);
	if (token === null || session.isPending)
		return (
			<main className="container mx-auto px-4 py-8">
				<Skeleton className="mx-auto h-60 max-w-lg" />
			</main>
		);
	if (!inviteTokenInput.safeParse({ token }).success)
		return (
			<main className="container mx-auto flex flex-col gap-4 px-4 py-8">
				<h1 className="font-semibold text-2xl">Invitation unavailable</h1>
				<p>Open the complete invitation link from the project owner.</p>
				<Link href="/dashboard" className="underline">
					Back to projects
				</Link>
			</main>
		);
	if (!session.data?.user)
		return (
			<main className="container mx-auto px-4 py-8">
				<p className="text-center text-muted-foreground">
					Sign in or create an account to review your project invitation.
				</p>
				{showSignIn ? (
					<SignInForm
						onSwitchToSignUp={() => setShowSignIn(false)}
						onSuccess={() => {
							void session.refetch();
						}}
					/>
				) : (
					<SignUpForm
						onSwitchToSignIn={() => setShowSignIn(true)}
						onSuccess={() => {
							void session.refetch();
						}}
					/>
				)}
			</main>
		);
	return (
		<InviteAcceptance
			key={`${session.data.user.id}:${token}`}
			token={token}
			userName={session.data.user.name}
		/>
	);
}

function InviteAcceptance({
	token,
	userName,
}: {
	token: string;
	userName: string;
}) {
	const router = useRouter();
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof client.projects.previewInvite>
	> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	useEffect(() => {
		let active = true;
		client.projects
			.previewInvite({ token })
			.then((value) => {
				if (active) setPreview(value);
			})
			.catch((error) => {
				if (active)
					setError(
						error instanceof Error
							? error.message
							: "Could not load the invitation.",
					);
			});
		return () => {
			active = false;
		};
	}, [token]);
	return (
		<main className="container mx-auto px-4 py-8">
			<Card className="mx-auto max-w-lg">
				<CardHeader>
					<CardTitle>
						<h1>{preview ? `Join ${preview.name}` : "Project invitation"}</h1>
					</CardTitle>
					<CardDescription>Signed in as {userName}.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					{!preview && !error && <Skeleton className="h-20 w-full" />}
					{preview && (
						<p>
							{preview.role === "editor"
								? "You have been invited as an editor. You can open and rename this project."
								: "You have been invited as a viewer. You can open this project without making changes."}
						</p>
					)}
					{error && <p role="alert">{error}</p>}
				</CardContent>
				<CardFooter className="flex flex-wrap gap-3">
					{preview && (
						<Button
							disabled={pending}
							onClick={async () => {
								setPending(true);
								setError(null);
								try {
									const accepted = await client.projects.acceptInvite({
										token,
									});
									window.history.replaceState(null, "", "/invite");
									router.replace(`/projects/${accepted.projectId}`);
								} catch (error) {
									setError(
										error instanceof Error
											? error.message
											: "Could not accept the invitation.",
									);
									setPending(false);
								}
							}}
						>
							{pending ? "Joining…" : "Accept invitation"}
						</Button>
					)}
					<Link
						href="/dashboard"
						className={buttonVariants({ variant: "outline" })}
					>
						Back to projects
					</Link>
				</CardFooter>
			</Card>
		</main>
	);
}
