import { evlogMiddleware } from "evlog/next";

export const proxy = evlogMiddleware();

export const config = {
	// Provider input URLs contain a short-lived bearer token; exclude request logging.
	matcher: ["/api/((?!generation-inputs/).*)"],
};
