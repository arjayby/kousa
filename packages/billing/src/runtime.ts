import { createDb } from "@kousa/db";
import { createCreditStore } from "@kousa/db/credit-store";
import { createCreditLedger } from "./ledger";

export function createBilling() {
	return createCreditLedger(createCreditStore(createDb()));
}
