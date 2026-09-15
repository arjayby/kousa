import { createContext } from "@kousa/api/context";
import { appRouter } from "@kousa/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { NextRequest } from "next/server";

import { useLogger, withEvlog } from "@/lib/evlog";
import { identifyEvlogUser } from "@/lib/evlog-auth";

const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			// Validation errors and database causes can contain invitation credentials.
			useLogger().set({
				rpc: {
					code:
						error instanceof ORPCError ? error.code : "INTERNAL_SERVER_ERROR",
				},
			});
		}),
	],
});
const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			useLogger().set({
				rpc: {
					code:
						error instanceof ORPCError ? error.code : "INTERNAL_SERVER_ERROR",
				},
			});
		}),
	],
});

async function handleRequest(req: NextRequest) {
	await identifyEvlogUser(req);
	const rpcResult = await rpcHandler.handle(req, {
		prefix: "/api/rpc",
		context: await createContext(req),
	});
	if (rpcResult.response) return rpcResult.response;

	const apiResult = await apiHandler.handle(req, {
		prefix: "/api/rpc/api-reference",
		context: await createContext(req),
	});
	if (apiResult.response) return apiResult.response;

	return new Response("Not found", { status: 404 });
}

export const GET = withEvlog(handleRequest);
export const POST = withEvlog(handleRequest);
export const PUT = withEvlog(handleRequest);
export const PATCH = withEvlog(handleRequest);
export const DELETE = withEvlog(handleRequest);
