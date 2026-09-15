"use client";

import { Button } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { Separator } from "@kousa/ui/components/separator";
import { Skeleton } from "@kousa/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { client, orpc } from "@/utils/orpc";
import { RolePicker } from "./role-picker";

export function ProjectAccessPanel({
	userId,
	projectId,
}: {
	userId: string;
	projectId: string;
}) {
	const cache = useQueryClient();
	const linkInputId = useId();
	const queryKey = ["projects", userId, "access", projectId];
	const access = useQuery({
		...orpc.projects.access.queryOptions({ input: { projectId } }),
		queryKey,
		retry: false,
	});
	const [role, setRole] = useState<"viewer" | "editor">("viewer");
	const [invite, setInvite] = useState<{ id: string; url: string } | null>(
		null,
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	async function change(operation: () => Promise<unknown>) {
		setPending(true);
		setError(null);
		setStatus(null);
		try {
			await operation();
			await cache.invalidateQueries({ queryKey });
			setStatus("Access updated.");
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Could not update access.",
			);
		} finally {
			setPending(false);
		}
	}
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>Project access</h2>
				</CardTitle>
				<CardDescription>
					You own this project. Choose who can open or edit it.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				{access.isError ? (
					<p role="alert">
						Could not load access settings.{" "}
						<Button variant="link" onClick={() => access.refetch()}>
							Try again
						</Button>
					</p>
				) : access.isPending ? (
					<Skeleton className="h-32 w-full" />
				) : (
					<>
						<FieldGroup>
							<Field>
								<FieldLabel>Invite someone</FieldLabel>
								<RolePicker
									value={role}
									onChange={setRole}
									label="Invitation role"
									disabled={pending}
								/>
								<FieldDescription>
									Viewers can open the project. Editors can also rename it. Only
									you can manage access.
								</FieldDescription>
							</Field>
							<Field orientation="horizontal">
								<Button
									disabled={pending}
									onClick={() =>
										change(async () => {
											const created = await client.projects.createInvite({
												projectId,
												role,
											});
											setInvite({
												id: created.id,
												url: `${window.location.origin}/invite#${created.token}`,
											});
										})
									}
								>
									{pending ? "Updating…" : "Create invite link"}
								</Button>
							</Field>
							{invite && (
								<Field>
									<FieldLabel htmlFor={linkInputId}>Invitation link</FieldLabel>
									<Input
										id={linkInputId}
										value={invite.url}
										readOnly
										onFocus={(event) => event.target.select()}
									/>
									<FieldDescription>
										Copy this link before leaving. The first signed-in person to
										accept it gets access. It expires in seven days.
									</FieldDescription>
									<Button
										variant="outline"
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(invite.url);
												setStatus("Invite link copied.");
											} catch {
												setError(
													"Could not copy automatically. Select and copy the link above.",
												);
											}
										}}
									>
										Copy invite link
									</Button>
								</Field>
							)}
						</FieldGroup>
						<Separator />
						<section aria-label="Collaborators" className="flex flex-col gap-3">
							<h3 className="font-medium text-sm">Collaborators</h3>
							<p className="text-muted-foreground text-sm">You · Owner</p>
							{access.data.members.length === 0 && (
								<p className="text-muted-foreground text-sm">
									No collaborators yet.
								</p>
							)}
							{access.data.members.map((member) => (
								<div
									key={member.userId}
									className="flex flex-wrap items-center justify-between gap-3"
								>
									<p className="break-words text-sm">{member.name}</p>
									<div className="flex flex-wrap items-center gap-2">
										<RolePicker
											label={`Role for ${member.name}`}
											value={member.role}
											disabled={pending}
											onChange={(role) =>
												change(() =>
													client.projects.changeMember({
														projectId,
														userId: member.userId,
														role,
													}),
												)
											}
										/>
										<Button
											variant="ghost"
											disabled={pending}
											aria-label={`Remove ${member.name}`}
											onClick={() =>
												change(() =>
													client.projects.removeMember({
														projectId,
														userId: member.userId,
													}),
												)
											}
										>
											Remove
										</Button>
									</div>
								</div>
							))}
						</section>
						{access.data.invites.length > 0 && (
							<>
								<Separator />
								<section
									aria-label="Pending invitations"
									className="flex flex-col gap-3"
								>
									<h3 className="font-medium text-sm">Pending invitations</h3>
									{access.data.invites.map((item) => (
										<div
											key={item.id}
											className="flex flex-wrap items-center justify-between gap-3"
										>
											<p className="text-muted-foreground text-sm">
												{item.role} · Expires{" "}
												{new Intl.DateTimeFormat("en", {
													dateStyle: "medium",
													timeZone: "UTC",
												}).format(new Date(item.expiresAt))}
											</p>
											<Button
												variant="ghost"
												disabled={pending}
												aria-label={`Revoke ${item.role} invitation`}
												onClick={() =>
													change(async () => {
														await client.projects.revokeInvite({
															projectId,
															inviteId: item.id,
														});
														if (invite?.id === item.id) setInvite(null);
													})
												}
											>
												Revoke link
											</Button>
										</div>
									))}
								</section>
							</>
						)}
					</>
				)}
				{error && (
					<p role="alert" className="text-sm">
						{error}
					</p>
				)}
				{status && (
					<p role="status" className="text-muted-foreground text-sm">
						{status}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
