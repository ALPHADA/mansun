import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import "dotenv/config";

/**
 * e2e 공용 헬퍼 — dev 로그인, 소유자 DB 연결(RLS 우회), 회차/데이터 정리.
 * 전제: dev 서버(3100) + `pnpm db:reset` 시드. 스펙은 각자 필요한 상태를 SQL 로 보장(재실행 안정성).
 */
const OWNER = process.env.DATABASE_OWNER_URL;
if (!OWNER) throw new Error("DATABASE_OWNER_URL is not set (.env)");
export const sql = postgres(OWNER, { max: 1 });

export async function bypass() { await sql`select set_config('app.bypass_rls','on',false)`; }
export async function closeDb() { /* 워커가 스펙 파일 간 모듈을 공유하므로 여기서 커넥션을 닫지 않는다 (프로세스 종료 시 정리) */ }

export const MOBILE = { viewport: { width: 420, height: 900 } };
export const PASSWORD = "mansun1234";

/** dev 로그인 → 새 페이지. tenant 생략 시 단일 소속/플랫폼 기본 진입 */
export async function login(ctx: BrowserContext, email: string, tenant?: string): Promise<Page> {
  const page = await ctx.newPage();
  const q = new URLSearchParams({ email });
  if (tenant) q.set("tenant", tenant);
  await page.goto(`/api/dev/login?${q.toString()}`);
  await page.waitForLoadState("networkidle");
  return page;
}

/** KST 오늘 (YYYY-MM-DD) */
export function kstToday(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function tenantId(code = "gangu"): Promise<string> {
  const [t] = await sql`select id from tenants where code = ${code}`;
  if (!t) throw new Error(`tenant ${code} not found`);
  return t.id as string;
}
export async function userId(email: string): Promise<string> {
  const [u] = await sql`select id from users where email = ${email}`;
  if (!u) throw new Error(`user ${email} not found`);
  return u.id as string;
}
export async function brokerMembership(email: string, code = "gangu") {
  const [m] = await sql`select m.id, m.license_no from memberships m join users u on u.id = m.user_id join tenants t on t.id = m.tenant_id where u.email = ${email} and t.code = ${code} and m.role = 'broker'`;
  if (!m) throw new Error(`broker membership ${email}@${code} not found`);
  return { id: m.id as string, licenseNo: m.license_no as string };
}

export interface RoundRow { id: string; seq: number; status: string; label: string; date: string }
/** 오늘(KST) 회차 조회 */
export async function todayRound(seq: number, code = "gangu"): Promise<RoundRow | undefined> {
  const [r] = await sql`select r.id, r.seq, r.status, r.label, r.date::text as date from rounds r join tenants t on t.id = r.tenant_id where t.code = ${code} and r.date = ${kstToday()} and r.seq = ${seq}`;
  return r as RoundRow | undefined;
}

/** 회차에 묶인 도메인 데이터 전부 삭제 (재실행 안정성) */
export async function deleteRoundData(roundId: string) {
  await sql`delete from settlement_lines where auction_id in (select id from auctions where round_id = ${roundId})`;
  await sql`delete from settlements where round_id = ${roundId}`;
  await sql`delete from bid_revisions where bid_id in (select id from bids where auction_id in (select id from auctions where round_id = ${roundId}))`;
  await sql`delete from bids where auction_id in (select id from auctions where round_id = ${roundId})`;
  await sql`delete from auction_results where auction_id in (select id from auctions where round_id = ${roundId})`;
  await sql`delete from disputes where auction_id in (select id from auctions where round_id = ${roundId})`;
  await sql`delete from auctions where round_id = ${roundId}`;
  await sql`delete from intakes where round_id = ${roundId}`;
  await sql`delete from notices where round_id = ${roundId}`;
  await sql`delete from round_subscriptions where round_id = ${roundId}`;
}

/**
 * 오늘 seq 회차를 지정 상태/시각으로 리셋(없으면 생성). 기존 물품·입고·입찰 등은 삭제.
 * auto_noticed_at 을 채워 스케줄러 자동 공지가 개입하지 않게 한다.
 */
export async function resetRound(seq: number, opts: { status: string; startMin: number; closeMin: number; fieldMin: number | null; label?: string }, code = "gangu"): Promise<RoundRow> {
  const tid = await tenantId(code);
  const today = kstToday();
  const label = opts.label ?? `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} 오전 ${seq}회차`;
  const existing = await todayRound(seq, code);
  if (existing) await deleteRoundData(existing.id);
  const start = sql`now() + make_interval(mins => ${opts.startMin}::int)`;
  const close = sql`now() + make_interval(mins => ${opts.closeMin}::int)`;
  const field = opts.fieldMin == null ? sql`null::timestamptz` : sql`now() + make_interval(mins => ${opts.fieldMin}::int)`;
  if (existing) {
    await sql`update rounds set status = ${opts.status}, label = ${label}, bid_start_at = ${start}, bid_close_at = ${close}, field_start_at = ${field}, auto_noticed_at = now(), closing_notified_at = null where id = ${existing.id}`;
    return (await todayRound(seq, code))!;
  }
  await sql`insert into rounds (tenant_id, date, seq, label, bid_start_at, bid_close_at, field_start_at, status, auto_noticed_at)
    values (${tid}, ${today}, ${seq}, ${label}, ${start}, ${close}, ${field}, ${opts.status}, now())`;
  return (await todayRound(seq, code))!;
}

/** 스케줄러 tick — 동시 실행 중이면 skipped 이므로 조건 충족까지 반복 */
export async function tickUntil(request: APIRequestContext, check: () => Promise<boolean>, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = await request.post("/api/internal/tick");
    expect(r.ok()).toBeTruthy();
    if (await check()) return;
    await new Promise((res) => setTimeout(res, 700));
  }
  expect(await check(), "tick 조건이 충족되지 않음").toBeTruthy();
}

/** DB 상태가 기대값이 될 때까지 폴링 */
export async function pollDb<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((res) => setTimeout(res, 400));
  } while (Date.now() < until);
  return last;
}

/** 페이지 토스트(role=status) 텍스트 대기 */
export async function expectToast(page: Page, re: RegExp | string, timeout = 15_000) {
  await expect(page.getByRole("status")).toContainText(re, { timeout });
}
