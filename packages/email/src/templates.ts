import type { EmailContent } from "./sender";

const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);

export function projectInvitationEmail(input: {
	to: string;
	projectName: string;
	role: "editor" | "viewer";
	expiresAt: Date;
	url: string;
}): EmailContent {
	const expires = new Intl.DateTimeFormat("en", {
		dateStyle: "long",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(input.expiresAt);
	const description = `You have been invited to ${input.projectName} as ${input.role === "editor" ? "an" : "a"} ${input.role}. Sign in with ${input.to} to accept. This invitation expires on ${expires} UTC.`;
	return {
		to: input.to,
		subject: "You're invited to a Kousa project",
		text: `${description}\n\nAccept invitation: ${input.url}\n\nIf you weren't expecting this invitation, you can ignore it.`,
		html: `<h1>Join a project on Kousa</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(input.url)}">Review invitation</a></p><p>If you weren't expecting this invitation, you can ignore it.</p>`,
	};
}

export function verificationEmail(to: string, url: string): EmailContent {
	return {
		to,
		subject: "Verify your Kousa email address",
		text: `Verify your email address: ${url}\n\nThis link expires in one hour. Then return to your project invitation to accept it.`,
		html: `<h1>Verify your email address</h1><p><a href="${escapeHtml(url)}">Verify email</a></p><p>This link expires in one hour. Then return to your project invitation to accept it.</p>`,
	};
}
