import { z } from "zod";

import { websiteIdSchema, workspaceIdSchema } from "../workspaces/contract";

export const websiteNameSchema = z.string().trim().min(1, "Enter a Website name").max(100);
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const hostnameSchema = z
  .string()
  .max(253)
  .refine(
    (hostname) =>
      hostname === "localhost" ||
      (hostname.includes(".") &&
        !/^[\d.]+$/.test(hostname) &&
        hostname.split(".").every((label) => dnsLabel.test(label))),
    "Enter a valid DNS hostname or localhost",
  )
  .brand<"WebsiteHostname">();

export const hostnameInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a hostname")
  .max(2048)
  .transform((input, context) => {
    try {
      if (
        input.includes("\\") ||
        Array.from(input).some(
          (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        ) ||
        input.startsWith("/")
      )
        throw new Error("Invalid hostname");
      const source = input.includes("://") ? input : `https://${input}`;
      const authority = source.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
      const url = new URL(source);
      if (!authority || authority.includes("@") || !["http:", "https:"].includes(url.protocol))
        throw new Error("Invalid URL");
      return hostnameSchema.parse(url.hostname.toLowerCase().replace(/\.$/, ""));
    } catch {
      context.issues.push({
        code: "custom",
        input,
        message:
          "Enter a valid DNS hostname or localhost, without credentials, IP addresses, or wildcards",
      });
      return z.NEVER;
    }
  });
export const publicTrackingIdSchema = z.uuid().brand<"PublicTrackingId">();
export const websiteSettingsSchema = z.object({
  id: websiteIdSchema,
  workspaceId: workspaceIdSchema,
  name: websiteNameSchema,
  hostname: hostnameSchema,
  publicTrackingId: publicTrackingIdSchema,
});
export const websiteFieldsSchema = z.object({
  name: websiteNameSchema,
  hostname: hostnameInputSchema,
});
export type Website = z.infer<typeof websiteSettingsSchema>;
export type TrackingScriptConfig = { url: string | null; allowLocalHttp: boolean };

const installationFields = { publicTrackingId: publicTrackingIdSchema, snippet: z.string() };
export const installationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("configured"), scriptUrl: z.url(), ...installationFields }),
  z.object({ kind: z.literal("unconfigured"), ...installationFields }),
]);
