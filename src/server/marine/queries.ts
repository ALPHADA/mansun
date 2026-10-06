import { db } from "../db";
import { kstDay } from "../../lib/model";
import { AppError } from "../auth";
import {
  change,
  daySchema,
  portFor,
  ports,
  shiftDay,
  sources,
  type Source,
} from "./model";

export type Snapshot = {
  data: unknown[];
  issued_at: string | null;
  fetched_at: string;
  status: string;
  message: string;
};
export async function conditions(id?: string, day = kstDay()) {
  if (id && !ports.some((p) => p.id === id))
    throw new AppError("항구를 확인해주세요.");
  daySchema.parse(day);
  if (day < kstDay() || day > shiftDay(kstDay(), 6))
    throw new AppError("오늘부터 7일 이내 날짜를 선택해주세요.");
  const port = portFor(id),
    sql = db();
  const snapshots =
    await sql`SELECT * FROM marine_snapshots WHERE (scope=${port.id} AND (basis_day=${day} OR basis_day='')) OR (source='warning' AND scope='national')`;
  const jobs =
    await sql`SELECT source,status,message FROM marine_jobs WHERE (scope=${port.id} AND (basis_day=${day} OR basis_day='')) OR (source='warning' AND scope='national')`;
  const feeds = Object.fromEntries(
    (["tide", "sea", "land", "warning"] as const).map((source) => {
      const s = snapshots.find((s) => s.source === source),
        j = jobs.find((j) => j.source === source);
      const ttl =
        source === "warning"
          ? 15 * 60000
          : source === "tide"
            ? 36 * 3600000
            : source === "sea"
              ? 14 * 3600000
              : 8 * 3600000;
      const stale =
        s &&
        (Date.now() - new Date(s.fetched_at).getTime() > ttl ||
          (source !== "tide" &&
            source !== "warning" &&
            (!s.issued_at ||
              Date.now() - new Date(s.issued_at).getTime() > ttl)));
      return [
        source,
        {
          data: s?.data ?? [],
          issued_at: s?.issued_at ?? null,
          fetched_at: s?.fetched_at ?? null,
          status: s
            ? stale ||
              j?.status === "error" ||
              j?.status === "pending" ||
              j?.status === "empty"
              ? "stale"
              : "ready"
            : j?.status === "error"
              ? "error"
              : "pending",
          message:
            s && stale
              ? "갱신 지연 · 이전 자료입니다"
              : j?.message || (!s ? "API 승인·연결 대기" : ""),
          source: { name: sources[source].name, url: sources[source].url },
        },
      ];
    }),
  );
  return { port, day, feeds };
}
export async function dataStatus() {
  const sql = db();
  const jobs =
    await sql`SELECT id,source,scope,basis_day,status,message,next_run,last_attempt,last_success,page,expected,attempts FROM marine_jobs ORDER BY source,basis_day DESC,scope`;
  const [heartbeat] =
    await sql`SELECT seen_at FROM marine_heartbeat WHERE id=true`;
  return {
    jobs,
    heartbeat: heartbeat?.seen_at ?? null,
    sources: Object.entries(sources).map(([id, s]) => ({
      id,
      ...s,
      configured: !!process.env[s.env],
    })),
  };
}
export async function trends(input: Record<string, string | undefined> = {}) {
  const sql = db(),
    today = kstDay();
  const [latest] =
    await sql`SELECT max(day) AS day FROM marine_auction_days WHERE day<${today}`;
  const day = daySchema.parse(input.day || latest?.day || shiftDay(today, -1));
  if (day > today || day < "2000-01-01")
    throw new AppError("기준일을 확인해주세요.");
  const width = input.period === "week" ? 7 : 1;
  const region = (input.region || "").slice(0, 60),
    market = (input.market || "").slice(0, 200),
    species = (input.species || "").slice(0, 100);
  const start = shiftDay(day, -29),
    from = shiftDay(day, 1 - width),
    before = shiftDay(from, -width);
  const coverage =
    await sql`SELECT day,fetched_at FROM marine_auction_days WHERE day BETWEEN ${start} AND ${day}`;
  const unresolvedRegions = region
    ? await sql`SELECT DISTINCT day FROM marine_auction_rows WHERE day BETWEEN ${start} AND ${day} AND region='지역 미확인'`
    : [];
  const daily =
    await sql`SELECT day,sum(amount)::float8 AS amount,CASE WHEN count(*) FILTER(WHERE weight IS NULL)=0 THEN sum(weight)::float8 ELSE NULL END AS weight FROM marine_auction_rows WHERE day BETWEEN ${start} AND ${day}
    AND (${region}='' OR region=${region}) AND (${market}='' OR market=${market}) AND (${species}='' OR species=${species}) GROUP BY day ORDER BY day`;
  const chart = Array.from({ length: 30 }, (_, i) => {
    const d = shiftDay(start, i),
      complete =
        coverage.some((c) => c.day === d) &&
        !unresolvedRegions.some((r) => r.day === d),
      row = daily.find((r) => r.day === d);
    return {
      day: d,
      complete,
      amount: complete ? (row ? Number(row.amount) : 0) : null,
      weight: complete
        ? row
          ? row.weight === null
            ? null
            : Number(row.weight)
          : 0
        : null,
    };
  });
  const sum = (a: string, b: string, key: "amount" | "weight") => {
    const range = chart.filter((d) => d.day >= a && d.day <= b);
    return range.some((d) => !d.complete || d[key] === null)
      ? null
      : range.reduce((n, d) => n + d[key]!, 0);
  };
  const amount = sum(from, day, "amount"),
    weight = sum(from, day, "weight"),
    previousEnd = shiftDay(from, -1);
  const amountChange = change(amount, sum(before, previousEnd, "amount")),
    weightChange = change(weight, sum(before, previousEnd, "weight"));
  const groups = await sql<
    {
      species: string;
      state: string;
      grade: string;
      unit: string;
      amount: number | null;
      weight: number | null;
      previous_weight: number | null;
      previous_amount: number | null;
      invalid_price: number;
      previous_invalid_price: number;
    }[]
  >`SELECT species,state,grade,unit,
    coalesce(sum(amount) FILTER(WHERE day>=${from}),0)::float8 AS amount,
    CASE WHEN count(*) FILTER(WHERE day>=${from} AND weight IS NULL)=0 THEN coalesce(sum(weight) FILTER(WHERE day>=${from}),0)::float8 END AS weight,
    CASE WHEN count(*) FILTER(WHERE day<${from} AND weight IS NULL)=0 THEN coalesce(sum(weight) FILTER(WHERE day<${from}),0)::float8 END AS previous_weight,
    coalesce(sum(amount) FILTER(WHERE day<${from}),0)::float8 AS previous_amount,
    count(*) FILTER(WHERE day>=${from} AND (weight IS NULL OR weight<=0 OR amount<=0))::int AS invalid_price,
    count(*) FILTER(WHERE day<${from} AND (weight IS NULL OR weight<=0 OR amount<=0))::int AS previous_invalid_price
    FROM marine_auction_rows WHERE day BETWEEN ${before} AND ${day} AND (${region}='' OR region=${region}) AND (${market}='' OR market=${market}) AND (${species}='' OR species=${species})
    GROUP BY species,state,grade,unit ORDER BY species,state,grade,unit LIMIT 201`;
  const options =
    await sql`SELECT DISTINCT region,market,species FROM marine_auction_rows WHERE day BETWEEN ${start} AND ${day}`;
  const [job] =
    await sql`SELECT status,message FROM marine_jobs WHERE source='auction' AND basis_day=${day}`;
  const completeCurrent = chart
    .filter((c) => c.day >= from)
    .every((c) => c.complete);
  const completePrevious = chart
    .filter((c) => c.day >= before && c.day < from)
    .every((c) => c.complete);
  return {
    day,
    from,
    before,
    previousEnd,
    period: width === 7 ? "week" : "day",
    region,
    market,
    species,
    amount,
    weight,
    amountChange,
    weightChange: {
      ...weightChange,
      reason:
        weightChange.delta === null && completeCurrent && completePrevious
          ? "중량 단위 확인 대기"
          : weightChange.reason,
    },
    chart,
    provisional: day === today,
    fetchedAt: coverage.find((c) => c.day === day)?.fetched_at ?? null,
    status: coverage.some((c) => c.day === day)
      ? "ready"
      : job?.status === "error"
        ? "error"
        : job?.status === "empty"
          ? "empty"
          : "pending",
    message: job?.message || "API 승인·연결 대기",
    source: { name: sources.auction.name, url: sources.auction.url },
    completeCurrent,
    completePrevious,
    groups: groups.slice(0, 200).map((g) => ({
      ...g,
      weight: completeCurrent ? g.weight : null,
      amount: completeCurrent ? g.amount : null,
      previous_weight: completePrevious ? g.previous_weight : null,
      previous_amount: completePrevious ? g.previous_amount : null,
      price:
        completeCurrent &&
        g.invalid_price === 0 &&
        g.weight !== null &&
        g.amount !== null &&
        g.weight > 0 &&
        g.amount > 0
          ? g.amount / g.weight
          : null,
      previousPrice:
        completePrevious &&
        g.previous_invalid_price === 0 &&
        g.previous_weight !== null &&
        g.previous_amount !== null &&
        g.previous_weight > 0 &&
        g.previous_amount > 0
          ? g.previous_amount / g.previous_weight
          : null,
      change: change(
        completeCurrent ? (g.weight === null ? null : Number(g.weight)) : null,
        completePrevious
          ? g.previous_weight === null
            ? null
            : Number(g.previous_weight)
          : null,
      ),
    })),
    hasMore: groups.length > 200,
    options: {
      regions: [...new Set(options.map((o) => String(o.region)))]
        .filter((r) => r !== "지역 미확인")
        .sort(),
      markets: [
        ...new Set(
          options
            .filter((o) => !region || o.region === region)
            .map((o) => String(o.market)),
        ),
      ].sort(),
      species: [
        ...new Set(
          options
            .filter(
              (o) =>
                (!region || o.region === region) &&
                (!market || o.market === market),
            )
            .map((o) => String(o.species)),
        ),
      ].sort(),
    },
    missingDays: chart
      .filter((c) => c.day >= before && !c.complete)
      .map((c) => c.day),
  };
}
export const sourceNames = (s: string) => sources[s as Source]?.name || s;

// Only public official data is cached. Bound both lifetime and key count.
const trendCache = new Map<
  string,
  { expires: number; value: Awaited<ReturnType<typeof trends>> }
>();
export async function cachedTrends(
  input: Record<string, string | undefined> = {},
) {
  const normalized = Object.fromEntries(
    ["day", "period", "region", "market", "species"].map((k) => [
      k,
      (input[k] || "").slice(0, 200),
    ]),
  );
  const key = JSON.stringify(normalized),
    old = trendCache.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const value = await trends(normalized);
  if (trendCache.size >= 100)
    trendCache.delete(trendCache.keys().next().value!);
  trendCache.set(key, { expires: Date.now() + 30000, value });
  return value;
}
