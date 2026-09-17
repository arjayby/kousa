// This is an operator-configured origin, never a client-supplied image URL.
export function generationImageOrigin(
	value: string | undefined,
): string | null {
	try {
		const url = new URL(value ?? "");
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			(url.port && url.port !== "443") ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname) ||
			/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) ||
			url.hostname.endsWith(".arpa")
		)
			return null;
		return url.origin;
	} catch {
		return null;
	}
}
