import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Purchase grants are append-only. Server-owned generation runs track reservations and debits.
export const creditGrant = pgTable(
	"credit_grant",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		polarOrderId: text("polar_order_id").notNull().unique(),
		polarCheckoutId: text("polar_checkout_id").notNull().unique(),
		polarCustomerId: text("polar_customer_id").notNull(),
		polarProductId: text("polar_product_id").notNull(),
		credits: integer("credits").notNull(),
		amount: integer("amount").notNull(),
		currency: text("currency").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("credit_grant_user_id_idx").on(table.userId),
		check("credit_grant_positive_credits", sql`${table.credits} > 0`),
		check("credit_grant_positive_amount", sql`${table.amount} > 0`),
	],
);
