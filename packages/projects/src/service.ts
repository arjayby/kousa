import type { ProjectStore } from "@kousa/db/project-store";
import { EmailDeliveryError, type EmailSender } from "@kousa/email/sender";
import { projectInvitationEmail } from "@kousa/email/templates";
import { canvasDocumentSchema } from "./canvas";
import type { CollaborationService } from "./collaboration";
import {
	changeMemberInput,
	createInviteInput,
	createProjectInput,
	inviteTokenInput,
	listProjectsInput,
	memberInput,
	permissionsFor,
	projectAccessInput,
	projectIdInput,
	renameProjectInput,
	resendInviteInput,
	revokeInviteInput,
	saveCanvasInput,
} from "./contracts";

export class ProjectError extends Error {
	constructor(
		public readonly code:
			| "NOT_FOUND"
			| "FORBIDDEN"
			| "INVALID_INVITE"
			| "CONFLICT"
			| "EMAIL_NOT_VERIFIED"
			| "SERVICE_UNAVAILABLE",
		message?: string,
	) {
		super(
			message ??
				(code === "CONFLICT"
					? "This email already has access or a pending invitation, or was invited too recently. Manage the existing entry below."
					: code === "EMAIL_NOT_VERIFIED"
						? "Verify your email address before accepting this invitation."
						: code === "INVALID_INVITE"
							? "This invitation is unavailable for this account. Sign in with the invited email address, or ask the owner for a new invitation."
							: code === "FORBIDDEN"
								? "You do not have permission to do this."
								: "Project not found."),
		);
	}
}

export async function hashInviteToken(token: string) {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function createProjectService(
	store: ProjectStore,
	options: {
		email: EmailSender;
		appUrl: string;
		collaboration?: CollaborationService;
	},
) {
	function newToken() {
		return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
	}
	async function deliver(
		invite: NonNullable<Awaited<ReturnType<ProjectStore["createInvite"]>>>,
		projectName: string,
		token: string,
		tokenHash: string,
	) {
		let outcome: { messageId: string | null } | { error: string };
		try {
			const url = new URL("/invite", options.appUrl);
			if (!["http:", "https:"].includes(url.protocol))
				throw new EmailDeliveryError("not_configured");
			url.hash = token;
			outcome = await options.email.send(
				projectInvitationEmail({
					to: invite.email,
					projectName,
					role: invite.role,
					expiresAt: invite.expiresAt,
					url: url.toString(),
				}),
			);
		} catch (error) {
			outcome = {
				error: error instanceof EmailDeliveryError ? error.code : "unconfirmed",
			};
		}
		await store.completeDelivery(invite.id, tokenHash, outcome);
		return {
			id: invite.id,
			email: invite.email,
			deliveryStatus:
				"error" in outcome ? ("failed" as const) : ("sent" as const),
			deliveryError: "error" in outcome ? outcome.error : null,
		};
	}

	async function get(actorId: string, input: unknown) {
		const { projectId } = projectIdInput.parse(input);
		const found = await store.get(actorId, projectId);
		if (!found) throw new ProjectError("NOT_FOUND");
		return { ...found, permissions: permissionsFor(found.role) };
	}
	async function requireOwner(actorId: string, projectId: string) {
		const found = await get(actorId, { projectId });
		if (found.role !== "owner") throw new ProjectError("FORBIDDEN");
		return found;
	}
	return {
		get,
		async getCanvas(actorId: string, input: unknown) {
			const { projectId } = projectIdInput.parse(input);
			const found = await store.getCanvas(actorId, projectId);
			if (!found) throw new ProjectError("NOT_FOUND");
			const { roomId, ...saved } = found;
			if (roomId) {
				if (!options.collaboration)
					throw new ProjectError(
						"SERVICE_UNAVAILABLE",
						"Live collaboration is unavailable.",
					);
				return { ...saved, document: await options.collaboration.read(roomId) };
			}
			return { ...saved, document: canvasDocumentSchema.parse(found.document) };
		},
		async saveCanvas(actorId: string, input: unknown) {
			const { projectId, expectedRevision, document } =
				saveCanvasInput.parse(input);
			const saved = await store.saveCanvas(
				actorId,
				projectId,
				expectedRevision,
				document,
			);
			if (saved) return { ...saved, document };
			const access = await get(actorId, { projectId });
			if (!access.permissions.canEdit) throw new ProjectError("FORBIDDEN");
			throw new ProjectError(
				"CONFLICT",
				"The canvas changed since you opened it. Load the saved version before editing again.",
			);
		},
		async create(actorId: string, input: unknown) {
			const { name } = createProjectInput.parse(input);
			return store.create(actorId, name);
		},
		async list(actorId: string, input: unknown = {}) {
			return store.list(actorId, listProjectsInput.parse(input).offset);
		},
		async rename(actorId: string, input: unknown) {
			const { projectId, name } = renameProjectInput.parse(input);
			if (!(await store.rename(actorId, projectId, name))) {
				await get(actorId, { projectId });
				throw new ProjectError("FORBIDDEN");
			}
			return { id: projectId };
		},
		async access(actorId: string, input: unknown) {
			const { projectId, offset } = projectAccessInput.parse(input);
			await requireOwner(actorId, projectId);
			const [members, invites] = await Promise.all([
				store.members(actorId, projectId),
				store.invites(actorId, projectId, offset),
			]);
			return {
				members,
				invites,
				emailDeliveryReady: options.email.isConfigured(),
			};
		},
		async changeMember(actorId: string, input: unknown) {
			const { projectId, userId, role } = changeMemberInput.parse(input);
			await requireOwner(actorId, projectId);
			const change = () => store.changeMember(actorId, projectId, userId, role);
			if (
				!(await (options.collaboration
					? options.collaboration.changeAccess(
							actorId,
							projectId,
							userId,
							role,
							change,
						)
					: change()))
			)
				throw new ProjectError("NOT_FOUND");
			return { userId };
		},
		async removeMember(actorId: string, input: unknown) {
			const { projectId, userId } = memberInput.parse(input);
			await requireOwner(actorId, projectId);
			const change = () => store.removeMember(actorId, projectId, userId);
			if (
				!(await (options.collaboration
					? options.collaboration.changeAccess(
							actorId,
							projectId,
							userId,
							null,
							change,
						)
					: change()))
			)
				throw new ProjectError("NOT_FOUND");
			return { userId };
		},
		async createInvite(actorId: string, input: unknown) {
			const { projectId, email, role, expiresInDays } =
				createInviteInput.parse(input);
			const project = await requireOwner(actorId, projectId);
			const token = newToken();
			const tokenHash = await hashInviteToken(token);
			const created = await store.createInvite(
				actorId,
				projectId,
				email,
				role,
				tokenHash,
				expiresInDays,
			);
			if (!created) throw new ProjectError("CONFLICT");
			return deliver(created, project.name, token, tokenHash);
		},
		async resendInvite(actorId: string, input: unknown) {
			const { projectId, inviteId } = resendInviteInput.parse(input);
			const project = await requireOwner(actorId, projectId);
			const token = newToken();
			const tokenHash = await hashInviteToken(token);
			const updated = await store.resendInvite(
				actorId,
				projectId,
				inviteId,
				tokenHash,
			);
			if (!updated) throw new ProjectError("CONFLICT");
			return deliver(updated, project.name, token, tokenHash);
		},
		async revokeInvite(actorId: string, input: unknown) {
			const { projectId, inviteId } = revokeInviteInput.parse(input);
			await requireOwner(actorId, projectId);
			if (!(await store.revokeInvite(actorId, projectId, inviteId)))
				throw new ProjectError("NOT_FOUND");
			return { id: inviteId };
		},
		async previewInvite(actorId: string, input: unknown) {
			const { token } = inviteTokenInput.parse(input);
			const found = await store.previewInvite(
				actorId,
				await hashInviteToken(token),
			);
			if (!found) throw new ProjectError("INVALID_INVITE");
			return found;
		},
		async acceptInvite(actorId: string, input: unknown) {
			const { token } = inviteTokenInput.parse(input);
			const accepted = await store.acceptInvite(
				actorId,
				await hashInviteToken(token),
			);
			if (!accepted) {
				const preview = await store.previewInvite(
					actorId,
					await hashInviteToken(token),
				);
				if (preview?.requiresEmailVerification)
					throw new ProjectError("EMAIL_NOT_VERIFIED");
				throw new ProjectError("INVALID_INVITE");
			}
			return accepted;
		},
	};
}

export type ProjectService = ReturnType<typeof createProjectService>;
export type ProjectDetails = Awaited<ReturnType<ProjectService["get"]>>;
export type ProjectList = Awaited<ReturnType<ProjectService["list"]>>;
