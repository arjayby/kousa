import { createFileRoute } from "@tanstack/react-router";

import { WorkspacesHome } from "@/features/workspaces/components/workspaces-home";

export const Route = createFileRoute("/_auth/dashboard")({ component: WorkspacesHome });
