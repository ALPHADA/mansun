import { db } from "../db";
import { kstDay } from "../../lib/model";
import {
  collect,
  configured,
  sources,
  validDay,
  type Observation,
  type Provider,
} from "./providers";
export function recentDays(end = kstDay(), count = 3): string[] {
  if (!validDay(end) || !Number.isInteger(count) || count < 1 || count > 31)
    throw new Error("수집 범위는 올바른 날짜와 1~31일이어야 합니다");
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(end) - i * 86400000).toISOString().slice(0, 10),
  );
}
type Collector = (provider: Provider, day: string) => Promise<Observation[]>;
export async function syncDay(
  provider: Provider,
  day: string,
  options: { force?: boolean; collector?: Collector } = {},
) {
  if (!validDay(day) || day > kstDay())
    throw new Error("수집 날짜를 확인해주세요");
  if (!options.collector && !configured(provider))
    return { provider, day, status: "unconfigured", count: 0 };
  return db().begin(async (tx) => {
    const [lock] =
      await tx`SELECT pg_try_advisory_xact_lock(hashtext(${"official:" + provider + ":" + day})) AS acquired`;
    if (!lock.acquired) return { provider, day, status: "busy", count: 0 };
    const [recent] =
      await tx`SELECT 1 FROM official_sync_runs WHERE provider=${provider} AND basis_day=${day} AND attempted_at>now()-interval '4 hours'`;
    if (recent && !options.force)
      return { provider, day, status: "skipped", count: 0 };
    let rows: Observation[];
    try {
      rows = await (options.collector ?? collect)(provider, day);
      // A missing KAMIS sale stage is not a deletion instruction. Keep the
      // whole previous snapshot until both previously stored stages recover.
      if (provider === "kamis" && rows.length) {
        const previous =
          await tx`SELECT DISTINCT data->>'kind' AS kind FROM official_observations WHERE provider=${provider} AND basis_day=${day}`;
        const kinds = new Set(rows.map((row) => row.kind));
        if (previous.some((row) => !kinds.has(row.kind)))
          throw new Error("KAMIS 일부 판매단계 자료 누락");
      }
      const keys = new Set<string>();
      for (const r of rows) {
        if (
          r.day !== day ||
          keys.has(r.key) ||
          !Number.isFinite(r.low) ||
          !Number.isFinite(r.high) ||
          r.low <= 0 ||
          r.high < r.low
        )
          throw new Error("날짜·중복·가격 검증 실패");
        keys.add(r.key);
      }
    } catch {
      // Do not persist external exception text: it can contain API secrets.
      await tx`INSERT INTO official_sync_runs(provider,basis_day,status,message) VALUES(${provider},${day},'error','제공처 연결 또는 응답 검증 실패. 기존 자료는 보존했습니다.') ON CONFLICT(provider,basis_day) DO UPDATE SET status='error',message=EXCLUDED.message,attempted_at=now()`;
      return { provider, day, status: "error", count: 0 };
    }
    // Empty responses may be a temporary source outage. Keep previously verified rows.
    if (rows.length) {
      await tx`DELETE FROM official_observations WHERE provider=${provider} AND basis_day=${day}`;
      for (const r of rows)
        await tx`INSERT INTO official_observations(provider,basis_day,item_key,region,species,market,data) VALUES(${provider},${day},${r.key},${r.region},${r.species},${r.market},${tx.json(r)})`;
    }
    const status = rows.length ? "success" : "empty";
    await tx`INSERT INTO official_sync_runs(provider,basis_day,status,item_count,message) VALUES(${provider},${day},${status},${rows.length},'') ON CONFLICT(provider,basis_day) DO UPDATE SET status=EXCLUDED.status,item_count=EXCLUDED.item_count,message='',attempted_at=now()`;
    return { provider, day, status, count: rows.length };
  });
}
export async function syncOfficialPrices(
  options: {
    end?: string;
    days?: number;
    force?: boolean;
    provider?: Provider;
  } = {},
) {
  const results = [];
  for (const provider of options.provider
    ? [options.provider]
    : (Object.keys(sources) as Provider[])) {
    for (const day of recentDays(options.end, options.days)) {
      const result = await syncDay(provider, day, options);
      results.push(result);
      // A malformed current day must not prevent collecting earlier valid days.
      if (result.status === "unconfigured") break;
    }
  }
  return results;
}
