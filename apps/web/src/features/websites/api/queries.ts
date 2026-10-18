import type { Website } from "@kousa/api/modules/websites/contract";
import type { WorkspaceId } from "@kousa/api/modules/workspaces/contract";

import { orpc } from "@/utils/orpc";

export const websiteListOptions = (workspaceId: WorkspaceId) =>
  orpc.websites.list.queryOptions({ input: { workspaceId }, meta: { workspaceId }, retry: false });

export const websiteOptions = (workspaceId: WorkspaceId, websiteId: Website["id"]) =>
  orpc.websites.get.queryOptions({
    input: { workspaceId, websiteId },
    meta: { workspaceId, websiteResource: true },
    retry: false,
  });

export const installationOptions = (workspaceId: WorkspaceId, websiteId: Website["id"]) =>
  orpc.websites.installation.queryOptions({
    input: { workspaceId, websiteId },
    meta: { workspaceId, websiteResource: true },
    retry: false,
  });
