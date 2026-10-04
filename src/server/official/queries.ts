import { db } from "../db";
import {
  type Observation,
  type Provider,
  configured,
  sources,
} from "./providers";
export async function officialReport(
  provider: Provider,
  day: string,
  region = "",
  query = "",
  page = 1,
) {
  const sql = db();
  const offset = (page - 1) * 50;
  const rows = await sql<
    { data: Observation; fetched_at: Date; total: number }[]
  >`
    SELECT data,fetched_at,count(*) OVER()::int AS total FROM official_observations
    WHERE provider=${provider} AND basis_day=${day}::date
      AND (${provider === "kamis" || !region} OR region=${region})
      AND (${!query} OR position(${query} in species)>0 OR position(${query} in market)>0)
    ORDER BY species,market,item_key LIMIT 50 OFFSET ${offset}`;
  const [latest] =
    await sql`SELECT max(basis_day)::text AS day FROM official_observations WHERE provider=${provider} AND basis_day<=${day}::date AND (${provider === "kamis" || !region} OR region=${region}) AND (${!query} OR position(${query} in species)>0 OR position(${query} in market)>0)`;
  const [run] =
    await sql`SELECT status,attempted_at FROM official_sync_runs WHERE provider=${provider} AND basis_day=${day}::date`;
  return {
    rows,
    total: rows[0]?.total ?? 0,
    latest: latest?.day as string | null,
    status: run?.status as string | undefined,
    configured: configured(provider),
  };
}
export async function officialSyncStatus() {
  const runs =
    await db()`SELECT provider,basis_day::text AS basis_day,status,item_count,message,attempted_at FROM official_sync_runs ORDER BY attempted_at DESC LIMIT 20`;
  return {
    sources: (Object.keys(sources) as Provider[]).map((provider) => ({
      provider,
      ...sources[provider],
      configured: configured(provider),
    })),
    runs,
  };
}
