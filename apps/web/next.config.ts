import "@kousa/env/web";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	typedRoutes: true,
	reactCompiler: true,
	logging: { incomingRequests: { ignore: [/\/api\/generation-inputs\//] } },
	// Share one Yjs instance across server routes; its type checks rely on identity.
	serverExternalPackages: ["yjs"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
