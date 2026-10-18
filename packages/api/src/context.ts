import type { Session } from "@kousa/auth";
import type { Database } from "@kousa/db";
import type { TrackingScriptConfig } from "./modules/websites/contract";

export type Context = {
  session: Session | null;
  db: Database;
  invitationAcceptanceEnabled: boolean;
  billingEnabled: boolean;
  trackingScript: TrackingScriptConfig;
  reportFailure: (cause: unknown) => void;
};
