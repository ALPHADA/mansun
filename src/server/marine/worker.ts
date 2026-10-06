import { randomUUID } from "node:crypto";
import { db } from "../db";
import { kstDay } from "../../lib/model";
import {
  nextRun,
  ports,
  portFor,
  shiftDay,
  sources,
  type Source,
} from "./model";
import {
  FeedError,
  fetchPage,
  normalize,
  normalizeAuction,
  type Job,
  type Row,
} from "./providers";

export async function seedJobs() {
  const sql = db(),
    today = kstDay();
  await sql.begin(async (tx) => {
    const jobs: { source: Source; scope: string; day: string }[] = [
      { source: "markets", scope: "national", day: "" },
      { source: "warning", scope: "national", day: "" },
      { source: "zones", scope: "national", day: "" },
    ];
    for (const p of ports) {
      for (const source of ["sea", "land"] as const)
        jobs.push({ source, scope: p.id, day: "" });
      for (let n = 0; n < 7; n++)
        jobs.push({ source: "tide", scope: p.id, day: shiftDay(today, n) });
    }
    for (let n = 1; n <= 30; n++)
      jobs.push({
        source: "auction",
        scope: "national",
        day: shiftDay(today, -n),
      });
    for (const j of jobs)
      await tx`INSERT INTO marine_jobs(id,source,scope,basis_day) VALUES(${[j.source, j.scope, j.day].join(":")},${j.source},${j.scope},${j.day}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO marine_heartbeat(id,seen_at) VALUES(true,now()) ON CONFLICT(id) DO UPDATE SET seen_at=now()`;
    await tx`DELETE FROM marine_jobs WHERE source='tide' AND basis_day < ${shiftDay(today, -7)}`;
    const unit = process.env.AUCTION_WEIGHT_UNIT === "kg" ? "kg" : "unknown";
    const [setting] =
      await tx`SELECT value FROM marine_settings WHERE key='weight_unit' FOR UPDATE`;
    if (!setting || setting.value !== unit) {
      await tx`INSERT INTO marine_settings(key,value) VALUES('weight_unit',${unit}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      await tx`UPDATE marine_jobs SET next_run=now() WHERE source='auction' AND basis_day>=${shiftDay(today, -30)} AND (lease_until IS NULL OR lease_until<now())`;
    }
    await tx`UPDATE marine_jobs SET next_run='2099-01-01' WHERE source='auction' AND basis_day<${shiftDay(today, -30)} AND status IN ('pending','empty','error') AND next_run>now() AND (lease_until IS NULL OR lease_until<now())`;
    await tx`DELETE FROM marine_quota WHERE day < ${shiftDay(today, -7)}`;
  });
}
export async function claimJob(
  lane: "auction" | "weather",
): Promise<Job | undefined> {
  const sql = db(),
    token = randomUUID();
  const [j] = await sql<
    Job[]
  >`UPDATE marine_jobs SET token=${token},lease_until=now()+interval '60 seconds',last_attempt=now(),started_at=CASE WHEN page=1 THEN now() ELSE started_at END,status='running'
    WHERE id=(SELECT id FROM marine_jobs WHERE next_run<=now() AND (lease_until IS NULL OR lease_until<now())
    AND ((source='auction')=${lane === "auction"})
    AND (source!='tide' OR basis_day>=${kstDay()})
    ORDER BY CASE WHEN source='warning' THEN 0 WHEN source='zones' THEN 1 ELSE 2 END,
    CASE WHEN page>1 THEN 0 ELSE 1 END, next_run, basis_day DESC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
  return j;
}
async function reserve(source: Source) {
  const sql = db(),
    family = sources[source].env;
  const rows =
    await sql`INSERT INTO marine_quota(source,day,calls) VALUES(${family},${kstDay()},1)
    ON CONFLICT(source,day) DO UPDATE SET calls=marine_quota.calls+1 WHERE marine_quota.calls<8000 RETURNING calls`;
  if (!rows.length)
    throw new FeedError("quota", "일일 요청 한도 · 다음 날 재시도");
}
export async function processJob(job: Job, fetcher = fetch) {
  const sql = db();
  try {
    const [zone] =
      job.source === "sea"
        ? await sql`SELECT data FROM marine_snapshots WHERE source='zones' AND scope='national' AND basis_day=''`
        : [];
    const zoneRows = (zone?.data ?? []) as { name: string; code: string }[];
    const matches = [
      ...new Set(
        zoneRows
          .filter((z) => z.name === portFor(job.scope).sea)
          .map((z) => z.code),
      ),
    ];
    const page = await fetchPage(
      job,
      matches.length === 1 ? matches[0] : undefined,
      () => reserve(job.source),
      fetcher,
    );
    if (job.expected !== null && job.expected !== page.total)
      throw new FeedError("error", "수집 중 전체 건수 변경 · 처음부터 재수집");
    if (page.total === 0 && job.page === 1)
      throw new FeedError(
        "empty",
        "제공처 자료 없음 · 무거래로 단정하지 않고 재확인",
      );
    if (job.page > 5000 || page.total > 500000 || !page.rows.length)
      throw new FeedError("error", "빈 응답 또는 페이지 한도 · 기존 자료 보존");
    await sql.begin(async (tx) => {
      const [owned] =
        await tx`SELECT id FROM marine_jobs WHERE id=${job.id} AND token=${job.token} AND lease_until>now() FOR UPDATE`;
      if (!owned) return;
      await tx`INSERT INTO marine_pages(job_id,generation,page,rows) VALUES(${job.id},${job.generation},${job.page},${tx.json(page.rows as never)}) ON CONFLICT(job_id,generation,page) DO UPDATE SET rows=excluded.rows`;
      const [{ count }] =
        await tx`SELECT sum(jsonb_array_length(rows))::int AS count FROM marine_pages WHERE job_id=${job.id} AND generation=${job.generation}`;
      if (count > page.total || page.rows.length > 100)
        throw new FeedError("error", "페이지 건수 불일치");
      if (count < page.total) {
        await tx`UPDATE marine_jobs SET page=page+1,expected=${page.total},lease_until=NULL,token=NULL,next_run=now(),status='collecting',attempts=0 WHERE id=${job.id}`;
        return;
      }
      const pages =
        await tx`SELECT rows FROM marine_pages WHERE job_id=${job.id} AND generation=${job.generation} ORDER BY page`;
      const rows = pages.flatMap((p) => p.rows as Row[]);
      let changedMarkets = false;
      if (job.source === "auction") {
        const [markets] =
          await tx`SELECT data FROM marine_snapshots WHERE source='markets' AND scope='national' AND basis_day=''`;
        const values = normalizeAuction(
          rows,
          job.basis_day,
          new Map(
            ((markets?.data ?? []) as { code: string; region: string }[]).map(
              (m) => [m.code, m.region],
            ),
          ),
        );
        await tx`INSERT INTO marine_auction_days(day,item_count) VALUES(${job.basis_day},${values.length}) ON CONFLICT(day) DO UPDATE SET item_count=excluded.item_count,fetched_at=now()`;
        await tx`DELETE FROM marine_auction_rows WHERE day=${job.basis_day}`;
        // Chunk inserts to stay below PostgreSQL's parameter limit.
        for (let i = 0; i < values.length; i += 1000)
          await tx`INSERT INTO marine_auction_rows ${tx(values.slice(i, i + 1000).map((r) => ({ day: job.basis_day, ...r })))}`;
      } else {
        const value = normalize(job, rows);
        const [old] =
          await tx`SELECT issued_at,data FROM marine_snapshots WHERE source=${job.source} AND scope=${job.scope} AND basis_day=${job.basis_day}`;
        changedMarkets =
          job.source === "markets" &&
          JSON.stringify(old?.data) !== JSON.stringify(value.data);
        if (
          old?.issued_at &&
          value.issuedAt &&
          new Date(value.issuedAt) < new Date(old.issued_at)
        )
          throw new FeedError("error", "이전 발표 응답 · 최신 자료 보존");
        await tx`INSERT INTO marine_snapshots(source,scope,basis_day,data,issued_at) VALUES(${job.source},${job.scope},${job.basis_day},${tx.json(value.data as never)},${value.issuedAt})
        ON CONFLICT(source,scope,basis_day) DO UPDATE SET data=excluded.data,issued_at=excluded.issued_at,fetched_at=now()`;
      }
      if (changedMarkets) {
        // Re-read after publication: the newly verified mapping must be applied to
        // the initial backfill as well as correction-window dates.
        await tx`UPDATE marine_jobs SET next_run=now() WHERE source='auction' AND basis_day>=${shiftDay(kstDay(), -30)} AND (lease_until IS NULL OR lease_until<now())`;
      }
      // Older backfill days are immutable until explicitly requeued by an admin.
      const next =
        job.source === "auction" && job.basis_day < shiftDay(kstDay(), -7)
          ? new Date("2099-01-01")
          : nextRun(job.source);
      await tx`DELETE FROM marine_pages WHERE job_id=${job.id}`;
      await tx`UPDATE marine_jobs SET status='success',next_run=${next},last_success=now(),attempts=0,message='',page=1,expected=NULL,generation=gen_random_uuid(),lease_until=NULL,token=NULL WHERE id=${job.id}`;
    });
  } catch (error) {
    const failure =
      error instanceof FeedError
        ? error
        : new FeedError("error", "응답 검증 실패 · 기존 자료 보존");
    const retain =
      failure.code === "quota" ||
      failure.code === "retry" ||
      failure.code === "pending";
    const state = failure.code === "retry" ? "error" : failure.code;
    const delay =
      failure.code === "empty"
        ? job.source === "auction" && job.basis_day < shiftDay(kstDay(), -30)
          ? new Date("2099-01-01").getTime() - Date.now()
          : nextRun(job.source).getTime() - Date.now()
        : failure.code === "pending"
          ? 3600000
          : failure.code === "quota"
            ? new Date(`${shiftDay(kstDay(), 1)}T00:05:00+09:00`).getTime() -
              Date.now()
            : Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6));
    await sql.begin(async (tx) => {
      const updated =
        await tx`UPDATE marine_jobs SET status=${state},message=${failure.message},attempts=CASE WHEN ${state === "error"} THEN attempts+1 ELSE 0 END,next_run=${new Date(Date.now() + delay)},lease_until=NULL,token=NULL,
        page=CASE WHEN ${retain} THEN page ELSE 1 END,expected=CASE WHEN ${retain} THEN expected ELSE NULL END,generation=CASE WHEN ${retain} THEN generation ELSE gen_random_uuid() END WHERE id=${job.id} AND token=${job.token} RETURNING id`;
      if (!updated.length) return;
      if (!retain) await tx`DELETE FROM marine_pages WHERE job_id=${job.id}`;
      if (
        (failure.code === "error" || failure.code === "retry") &&
        job.attempts >= 2
      )
        await tx`INSERT INTO notifications(user_id,title,body,href,dedupe)
        SELECT id,'공공데이터 수집 확인 필요',${sources[job.source].name + " · " + failure.message},'/admin',${`marine:${job.source}:${kstDay()}:`}||id::text FROM members WHERE admin=true AND suspended=false ON CONFLICT(dedupe) DO NOTHING`;
    });
  }
}
export async function retryJob(id: string) {
  const sql = db();
  const rows =
    await sql`UPDATE marine_jobs SET next_run=now() WHERE id=${id} AND (lease_until IS NULL OR lease_until<now()) RETURNING id`;
  return rows.length > 0;
}
