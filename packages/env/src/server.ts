/// <reference path="../env.d.ts" />
import { getCloudflareContext } from "@opennextjs/cloudflare";

function getNodeEnvValue(key: string) {
  if (key === "DB") {
    return undefined;
  }

  return process.env[key];
}

function getCloudflareEnvSync() {
  try {
    return getCloudflareContext().env as Env;
  } catch {
    return undefined;
  }
}

type EnvValue = Env[keyof Env];

function createEnvProxy(getValue: (key: keyof Env & string) => EnvValue | undefined) {
  return new Proxy({} as Env, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }

      return getValue(prop as keyof Env & string);
    },
  });
}

function resolveEnvValue(key: keyof Env & string): EnvValue | undefined {
  const nodeValue = getNodeEnvValue(key);
  if (nodeValue !== undefined) {
    return nodeValue as EnvValue;
  }

  return getCloudflareEnvSync()?.[key as keyof Env];
}

// Next.js local dev runs in Node.js, where env vars are exposed on process.env.
// In the Cloudflare runtime, fall back to OpenNext's Cloudflare context bindings.
// For static routes (ISR/SSG), use getEnvAsync() so OpenNext can resolve bindings
// with the async Cloudflare context API.
export async function getEnvAsync() {
  const cloudflareEnv = (await getCloudflareContext({ async: true })).env as Env;

  return createEnvProxy((key) => {
    const nodeValue = getNodeEnvValue(key);
    if (nodeValue !== undefined) {
      return nodeValue;
    }

    return cloudflareEnv[key as keyof Env];
  });
}

export const env = createEnvProxy(resolveEnvValue);
