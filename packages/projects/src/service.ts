import type { ProjectStore } from "@kousa/db/project-store";
import {
	changeMemberInput,
	createInviteInput,
	createProjectInput,
	inviteTokenInput,
	listProjectsInput,
	memberInput,
	permissionsFor,
	projectIdInput,
	renameProjectInput,
	revokeInviteInput,
} from "./contracts";

export class ProjectError extends Error {
	constructor(
		public readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_INVITE",
	) {
		super(
			code === "INVALID_INVITE"
				? "This invitation is unavailable. It may have expired, been revoked, or already been used."
				: code === "FORBIDDEN"
					? "You do not have permission to do this."
					: "Project not found.",
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

export function createProjectService(store: ProjectStore) {
	async function get(actorId: string, input: unknown) {
		const { projectId } = projectIdInput.parse(input);
		const found = await store.get(actorId, projectId);
		if (!found) throw new ProjectError("NOT_FOUND");
		return { ...found, permissions: permissionsFor(found.role) };
	}
	async function requireOwner(actorId: string, projectId: string) {
		const found = await get(actorId, { projectId });
		if (found.role !== "owner") throw new ProjectError("FORBIDDEN");
	}
	return {
		get,
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
			const { projectId } = projectIdInput.parse(input);
			await requireOwner(actorId, projectId);
			const [members, invites] = await Promise.all([
				store.members(actorId, projectId),
				store.invites(actorId, projectId),
			]);
			return { members, invites };
		},
		async changeMember(actorId: string, input: unknown) {
			const { projectId, userId, role } = changeMemberInput.parse(input);
			await requireOwner(actorId, projectId);
			if (!(await store.changeMember(actorId, projectId, userId, role)))
				throw new ProjectError("NOT_FOUND");
			return { userId };
		},
		async removeMember(actorId: string, input: unknown) {
			const { projectId, userId } = memberInput.parse(input);
			await requireOwner(actorId, projectId);
			if (!(await store.removeMember(actorId, projectId, userId)))
				throw new ProjectError("NOT_FOUND");
			return { userId };
		},
		async createInvite(actorId: string, input: unknown) {
			const { projectId, role } = createInviteInput.parse(input);
			await requireOwner(actorId, projectId);
			const token = Array.from(
				crypto.getRandomValues(new Uint8Array(32)),
				(byte) => byte.toString(16).padStart(2, "0"),
			).join("");
			const created = await store.createInvite(
				actorId,
				projectId,
				role,
				await hashInviteToken(token),
				new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			);
			if (!created) throw new ProjectError("NOT_FOUND");
			return { ...created, token };
		},
		async revokeInvite(actorId: string, input: unknown) {
			const { projectId, inviteId } = revokeInviteInput.parse(input);
			await requireOwner(actorId, projectId);
			if (!(await store.revokeInvite(actorId, projectId, inviteId)))
				throw new ProjectError("NOT_FOUND");
			return { id: inviteId };
		},
		async previewInvite(input: unknown) {
			const { token } = inviteTokenInput.parse(input);
			const found = await store.previewInvite(await hashInviteToken(token));
			if (!found) throw new ProjectError("INVALID_INVITE");
			return found;
		},
		async acceptInvite(actorId: string, input: unknown) {
			const { token } = inviteTokenInput.parse(input);
			const accepted = await store.acceptInvite(
				actorId,
				await hashInviteToken(token),
			);
			if (!accepted) throw new ProjectError("INVALID_INVITE");
			return accepted;
		},
	};
}

export type ProjectService = ReturnType<typeof createProjectService>;
export type ProjectDetails = Awaited<ReturnType<ProjectService["get"]>>;
export type ProjectList = Awaited<ReturnType<ProjectService["list"]>>;
