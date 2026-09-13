import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __mansunPg: ReturnType<typeof postgres> | undefined;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// dev HMR에서 커넥션 누수 방지
const client = globalThis.__mansunPg ?? postgres(url, { max: 10, idle_timeout: 30, prepare: false });
if (process.env.NODE_ENV !== "production") globalThis.__mansunPg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
