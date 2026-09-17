import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const workflowTemplate = pgTable(
	"workflow_template",
	{
		id: uuid("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// A saved snapshot survives loss of access to, or deletion of, its source.
		sourceProjectId: uuid("source_project_id").notNull(),
		requestHash: text("request_hash").notNull(),
		name: text("name").notNull(),
		document: jsonb("document"),
		nodeCount: integer("node_count").notNull(),
		edgeCount: integer("edge_count").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(t) => [
		index("workflow_template_owner_idx").on(t.ownerId, t.updatedAt),
		check(
			"workflow_template_name_length",
			sql`char_length(btrim(${t.name})) between 1 and 120`,
		),
		check(
			"workflow_template_counts",
			sql`${t.nodeCount} between 1 and 200 and ${t.edgeCount} between 0 and 600`,
		),
		check(
			"workflow_template_document_present",
			sql`(${t.deletedAt} is null) = (${t.document} is not null)`,
		),
	],
);
