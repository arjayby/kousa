export type DatabaseConfig = {
  DATABASE_MODE: "local" | "neon-http";
  DATABASE_URL: string;
};

export const localDatabaseConfig = {
  DATABASE_MODE: "local",
  DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa",
} satisfies DatabaseConfig;

export function assertLocalDatabaseUrl(value: string) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5432" ||
    !["/kousa", "/kousa_test"].includes(url.pathname) ||
    url.search !== ""
  ) {
    throw new Error("Local database must use loopback port 5432 and database kousa or kousa_test");
  }
}
