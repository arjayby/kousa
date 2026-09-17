import { createBilling } from "@kousa/billing/runtime";
import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { createClipRouter } from "./clips";
import { createGenerationRouter } from "./generation";
import { createGraphRouter } from "./graph";
import { createProjectsRouter } from "./projects";

export const appRouter = {
	clips: createClipRouter(),
	generation: createGenerationRouter(),
	graph: createGraphRouter(),
	projects: createProjectsRouter(),
	credits: {
		summary: protectedProcedure.handler(({ context }) =>
			createBilling().summary(context.session.user.id),
		),
	},
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
