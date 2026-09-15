"use client";

import { createInviteInput, type ProjectRole } from "@kousa/projects/contracts";
import { Badge } from "@kousa/ui/components/badge";
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
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldTitle,
} from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import { Separator } from "@kousa/ui/components/separator";
import { Skeleton } from "@kousa/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { client, orpc } from "@/utils/orpc";
import { RolePicker } from "./role-picker";

const formatDate = (date: Date | string) =>
	new Intl.DateTimeFormat("en", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(new Date(date));
const deliveryMessage = (code: string | null) =>
	code === "not_configured"
		? "Email delivery is not set up. No email was sent."
		: code === "rejected"
			? "The email provider rejected this message. Check the address before resending."
			: "Delivery could not be confirmed. Resending creates a new link and invalidates the previous one.";

export function ProjectAccessPanel({
	userId,
	projectId,
}: {
	userId: string;
	projectId: string;
}) {
	const cache = useQueryClient();
	const emailId = useId();
	const [offset, setOffset] = useState(0);
	const queryPrefix = ["projects", userId, "access", projectId];
	const access = useQuery({
		...orpc.projects.access.queryOptions({ input: { projectId, offset } }),
		queryKey: [...queryPrefix, offset],
		retry: false,
		refetchInterval: 30_000,
	});
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Exclude<ProjectRole, "owner">>("viewer");
	const [expiresInDays, setExpiresInDays] = useState<1 | 7 | 30>(7);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [emailError, setEmailError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	async function change(operation: () => Promise<string>) {
		setPending(true);
		setError(null);
		setStatus(null);
		try {
			const message = await operation();
			await cache.invalidateQueries({ queryKey: queryPrefix });
			setStatus(message);
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Could not update access.",
			);
		} finally {
			setPending(false);
		}
	}
	const deliveryResult = (
		result: Awaited<ReturnType<typeof client.projects.createInvite>>,
	) =>
		result.deliveryStatus === "sent"
			? `Invitation sent to ${result.email}.`
			: `Invitation saved for ${result.email}. ${deliveryMessage(result.deliveryError)}`;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>Project access</h2>
				</CardTitle>
				<CardDescription>
					Invite people by email and choose what they can do.
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
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const parsed = createInviteInput.safeParse({
									projectId,
									email,
									role,
									expiresInDays,
								});
								setEmailError(null);
								if (!parsed.success) {
									setEmailError(
										parsed.error.issues[0]?.message ??
											"Check the invitation details.",
									);
									return;
								}
								void change(async () => {
									const result = await client.projects.createInvite(
										parsed.data,
									);
									setEmail("");
									setOffset(0);
									return deliveryResult(result);
								});
							}}
						>
							<FieldGroup>
								<Field
									data-invalid={Boolean(emailError)}
									data-disabled={pending}
								>
									<FieldLabel htmlFor={emailId}>Email address</FieldLabel>
									<Input
										id={emailId}
										type="email"
										value={email}
										onChange={(event) => setEmail(event.target.value)}
										required
										maxLength={254}
										disabled={pending}
										autoComplete="off"
										placeholder="name@example.com"
										aria-invalid={Boolean(emailError)}
										aria-describedby={
											emailError ? `${emailId}-error` : undefined
										}
									/>
									{emailError && (
										<FieldError id={`${emailId}-error`}>
											{emailError}
										</FieldError>
									)}
								</Field>
								<Field>
									<FieldTitle>Role</FieldTitle>
									<RolePicker
										value={role}
										onChange={setRole}
										label="Invitation role"
										disabled={pending}
									/>
									<FieldDescription>
										Viewers can open the project. Editors can also rename it.
										Only you can manage access.
									</FieldDescription>
								</Field>
								<Field>
									<FieldTitle>Link expires in</FieldTitle>
									<ToggleGroup
										value={[String(expiresInDays)]}
										onValueChange={(values) => {
											const days = Number(values[0]);
											if (days === 1 || days === 7 || days === 30)
												setExpiresInDays(days);
										}}
										disabled={pending}
										aria-label="Invitation expiry"
										variant="outline"
									>
										<ToggleGroupItem value="1">1 day</ToggleGroupItem>
										<ToggleGroupItem value="7">7 days</ToggleGroupItem>
										<ToggleGroupItem value="30">30 days</ToggleGroupItem>
									</ToggleGroup>
									<FieldDescription>
										Only the account with this verified email address can accept
										the unique link.
									</FieldDescription>
								</Field>
								{!access.data.emailDeliveryReady && (
									<p className="text-muted-foreground text-sm">
										Email delivery is not set up yet. Invitations will be saved,
										but no email will be sent.
									</p>
								)}
								<Field orientation="horizontal">
									<Button type="submit" disabled={pending}>
										{pending ? "Working…" : "Send invitation"}
									</Button>
								</Field>
							</FieldGroup>
						</form>
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
									<div className="min-w-0">
										<p className="break-words text-sm">{member.name}</p>
										<p className="break-all text-muted-foreground text-sm">
											{member.email}
										</p>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										<RolePicker
											label={`Role for ${member.email}`}
											value={member.role}
											disabled={pending}
											onChange={(role) =>
												change(async () => {
													await client.projects.changeMember({
														projectId,
														userId: member.userId,
														role,
													});
													return "Role updated.";
												})
											}
										/>
										<Button
											variant="ghost"
											disabled={pending}
											aria-label={`Remove ${member.email}`}
											onClick={() =>
												change(async () => {
													await client.projects.removeMember({
														projectId,
														userId: member.userId,
													});
													return "Collaborator removed.";
												})
											}
										>
											Remove
										</Button>
									</div>
								</div>
							))}
						</section>
						<Separator />
						<section aria-label="Invitations" className="flex flex-col gap-4">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="font-medium text-sm">Invitations</h3>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => access.refetch()}
									disabled={access.isFetching}
								>
									Refresh status
								</Button>
							</div>
							<p className="text-muted-foreground text-sm">
								Each email has its own role and invitation. Resending replaces
								its link and restarts the expiry. Sent means the email provider
								accepted the message.
							</p>
							{access.data.invites.items.length === 0 && (
								<p className="text-muted-foreground text-sm">
									No invitations yet.
								</p>
							)}
							{access.data.invites.items.map((item) => (
								<div
									key={item.id}
									className="flex flex-col gap-2 border-b pb-4 last:border-0"
								>
									<p className="break-all font-medium text-sm">
										{item.email ?? "Legacy invitation without an email"}
									</p>
									<div className="flex flex-wrap items-center gap-2">
										<Badge variant="outline">{item.role}</Badge>
										<Badge variant="secondary">{item.status}</Badge>
										{item.email && item.status === "pending" && (
											<Badge
												variant={
													item.deliveryStatus === "failed"
														? "destructive"
														: "outline"
												}
											>
												{item.deliveryStatus === "sent"
													? "Sent"
													: item.deliveryStatus === "sending"
														? "Sending"
														: item.deliveryError === "not_configured"
															? "Not sent"
															: "Delivery failed"}
											</Badge>
										)}
									</div>
									<p className="text-muted-foreground text-sm">
										{item.status === "accepted" && item.acceptedAt
											? `Accepted ${formatDate(item.acceptedAt)}`
											: item.status === "revoked" && item.revokedAt
												? `Revoked ${formatDate(item.revokedAt)}`
												: `${item.status === "expired" ? "Expired" : "Expires"} ${formatDate(item.expiresAt)}`}{" "}
										UTC
									</p>
									{item.email &&
										item.status === "pending" &&
										item.deliveryStatus === "failed" && (
											<p className="text-muted-foreground text-sm">
												{deliveryMessage(item.deliveryError)}
											</p>
										)}
									{item.email && (
										<div className="flex flex-wrap gap-2">
											<Button
												variant="outline"
												size="sm"
												disabled={pending || !item.canResend}
												aria-label={`Resend invitation to ${item.email}`}
												onClick={() =>
													change(async () =>
														deliveryResult(
															await client.projects.resendInvite({
																projectId,
																inviteId: item.id,
															}),
														),
													)
												}
											>
												Resend
											</Button>
											{item.status === "pending" && (
												<Button
													variant="ghost"
													size="sm"
													disabled={pending}
													aria-label={`Revoke invitation to ${item.email}`}
													onClick={() =>
														change(async () => {
															await client.projects.revokeInvite({
																projectId,
																inviteId: item.id,
															});
															return "Invitation revoked.";
														})
													}
												>
													Revoke
												</Button>
											)}
										</div>
									)}
								</div>
							))}
							{(offset > 0 || access.data.invites.hasMore) && (
								<nav
									aria-label="Invitation pages"
									className="flex items-center gap-3"
								>
									<Button
										variant="outline"
										disabled={offset === 0 || access.isFetching}
										onClick={() =>
											setOffset((value) => Math.max(0, value - 20))
										}
									>
										Previous
									</Button>
									<span className="text-sm">Page {offset / 20 + 1}</span>
									<Button
										variant="outline"
										disabled={!access.data.invites.hasMore || access.isFetching}
										onClick={() => setOffset((value) => value + 20)}
									>
										Next
									</Button>
								</nav>
							)}
						</section>
					</>
				)}
				{error && (
					<p role="alert" className="text-sm">
						{error}
					</p>
				)}
				{status && (
					<p role="status" className="text-sm">
						{status}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
