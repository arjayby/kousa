import { z } from "zod";

export const authRedirectSchema = z
  .string()
  .regex(/^\/(?:dashboard|invite\/[a-f0-9]{64}|workspaces\/[a-f0-9-]{36})$/)
  .catch("/dashboard");
