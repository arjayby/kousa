import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { project } from "./schema/projects";
import { workflowTemplate as template } from "./schema/workflow-templates";

type Database = Pick<PgDatabase<PgQueryResultHKT>, "select" | "update">;
const summary = {
	id: template.id,
	name: template.name,
	nodeCount: template.nodeCount,
	edgeCount: template.edgeCount,
	createdAt: template.createdAt,
	updatedAt: template.updatedAt,
};
export function createTemplateStore(db: Database) {
	const owned = (actorId: string, id: string) =>
		and(eq(template.id, id), eq(template.ownerId, actorId));
	return {
		list(actorId: string) {
			return db
				.select(summary)
				.from(template)
				.where(and(eq(template.ownerId, actorId), isNull(template.deletedAt)))
				.orderBy(desc(template.updatedAt), desc(template.id))
				.limit(100);
		},
		async get(actorId: string, id: string) {
			return (
				(await db.select().from(template).where(owned(actorId, id)))[0] ?? null
			);
		},
		async save(
			actorId: string,
			input: {
				id: string;
				projectId: string;
				requestHash: string;
				name: string;
				document: unknown;
			},
		) {
			const [row] = await db
				.select({
					result: sql<string>`kousa_save_template(${input.id}::uuid, ${actorId}, ${input.projectId}::uuid, ${input.requestHash}, ${input.name}, ${JSON.stringify(input.document)}::jsonb)`,
				})
				.from(sql`(select 1) request`);
			if (!row) throw new Error("Template storage unavailable.");
			return row.result;
		},
		async rename(actorId: string, id: string, name: string) {
			return (
				(
					await db
						.update(template)
						.set({ name, updatedAt: new Date() })
						.where(and(owned(actorId, id), isNull(template.deletedAt)))
						.returning(summary)
				)[0] ?? null
			);
		},
		async remove(actorId: string, id: string) {
			// Keep the request identity so a delayed save cannot resurrect a deletion.
			return (
				(
					await db
						.update(template)
						.set({
							document: null,
							deletedAt: sql`coalesce(${template.deletedAt}, now())`,
							updatedAt: new Date(),
						})
						.where(owned(actorId, id))
						.returning({ id: template.id })
				)[0] ?? null
			);
		},
		async projectRequest(actorId: string, id: string) {
			return (
				(
					await db
						.select({
							id: project.id,
							requestHash: project.templateRequestHash,
						})
						.from(project)
						.where(and(eq(project.id, id), eq(project.ownerId, actorId)))
				)[0] ?? null
			);
		},
		async createProject(
			actorId: string,
			input: {
				id: string;
				templateId: string;
				requestHash: string;
				name: string;
				document: unknown;
			},
		) {
			const [row] = await db
				.select({
					result: sql<string>`kousa_project_from_template(${input.id}::uuid, ${actorId}, ${input.templateId}::uuid, ${input.requestHash}, ${input.name}, ${JSON.stringify(input.document)}::jsonb)`,
				})
				.from(sql`(select 1) request`);
			if (!row) throw new Error("Project storage unavailable.");
			return row.result;
		},
	};
}
export type TemplateStore = ReturnType<typeof createTemplateStore>;
