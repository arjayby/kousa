import { createClient } from "@clickhouse/client-web";

export type ClickHouseConfig = {
  CLICKHOUSE_URL: string;
  CLICKHOUSE_DATABASE: string;
  CLICKHOUSE_USERNAME: string;
  CLICKHOUSE_PASSWORD: string;
};

export function createClickHouse(config: ClickHouseConfig) {
  return createClient({
    url: config.CLICKHOUSE_URL,
    database: config.CLICKHOUSE_DATABASE,
    username: config.CLICKHOUSE_USERNAME,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: 5000,
  });
}
