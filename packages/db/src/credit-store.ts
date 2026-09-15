import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { creditGrant } from "./schema/credits";

type CreditGrantInput = Omit<
	typeof creditGrant.$inferInsert,
	"id" | "createdAt"
>;
type CreditDatabase = Pick<PgDatabase<PgQueryResultHKT>, "insert" | "select">;

export function createCreditStore(db: CreditDatabase) {
	return {
		async grant(input: CreditGrantInput) {
			// One insert is atomic on both Neon HTTP and Postgres. No read-then-write race.
			const [inserted] = await db
				.insert(creditGrant)
				.values(input)
				.onConflictDoNothing({ target: creditGrant.polarOrderId })
				.returning({ id: creditGrant.id });
			return Boolean(inserted);
		},
		async summary(userId: string) {
			const [total] = await db
				.select({
					balance: sql`coalesce(sum(${creditGrant.credits}), 0)`.mapWith(
						Number,
					),
				})
				.from(creditGrant)
				.where(eq(creditGrant.userId, userId));
			return { balance: total?.balance ?? 0 };
		},
		async findCheckoutGrant(userId: string, checkoutId: string) {
			const [grant] = await db
				.select({ credits: creditGrant.credits })
				.from(creditGrant)
				.where(
					and(
						eq(creditGrant.userId, userId),
						eq(creditGrant.polarCheckoutId, checkoutId),
					),
				)
				.limit(1);
			return grant ?? null;
		},
	};
}

export type CreditStore = ReturnType<typeof createCreditStore>;
