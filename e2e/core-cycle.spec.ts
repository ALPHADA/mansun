import { test, expect, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import "dotenv/config";

/**
 * 핵심 경매 사이클 스모크: 입찰 → 강제 마감(tick) → 현장 결과 입력/개찰 → 일괄 개찰 → 정산 생성·확정 → 선주/중매인 조회
 * 전제: dev 서버(3100) + 시드 DB (`pnpm db:reset`)
 */
const OWNER = process.env.DATABASE_OWNER_URL!;
const sql = postgres(OWNER, { max: 1 });

async function login(ctx: BrowserContext, email: string, tenant = "gangu") {
  const page = await ctx.newPage();
  await page.goto(`/api/dev/login?email=${encodeURIComponent(email)}&tenant=${tenant}`);
  await page.waitForLoadState("networkidle");
  return page;
}
async function bypass() { await sql`select set_config('app.bypass_rls','on',false)`; }

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => { await bypass(); });
test.afterAll(async () => { await sql.end(); });

test("① 중매인 밀봉 입찰 (신규 + 수정)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await login(ctx, "broker@gangu.kr");
  await page.goto("/t/gangu/broker/auctions");
  await expect(page.getByText("디지털 마감까지")).toBeVisible();
  // 미입찰 물품(A07 고등어 B등급 35kg) 입찰
  const [a07] = await sql`select id from auctions where auction_no like '%-A07'`;
  await page.goto(`/t/gangu/broker/bid/${a07.id}`);
  await page.getByLabel("입찰가").fill("7800");
  await expect(page.getByText(/273,000원/)).toBeVisible(); // 7,800 × 35
  await page.getByRole("button", { name: "🔨 입찰하기" }).click();
  await page.getByRole("button", { name: "입찰하기", exact: true }).click();
  await page.waitForURL(/broker\/results/);
  const [bid] = await sql`select price, revision from bids where auction_id = ${a07.id}`;
  expect(bid.price).toBe(7800);
  // 수정 (정책 허용)
  await page.goto(`/t/gangu/broker/bid/${a07.id}`);
  await page.getByLabel("입찰가").fill("8000");
  await page.getByRole("button", { name: "🔨 입찰 수정하기" }).click();
  await page.getByRole("button", { name: "입찰하기", exact: true }).click();
  await page.waitForURL(/broker\/results/);
  const [bid2] = await sql`select price, revision from bids where auction_id = ${a07.id}`;
  expect(bid2).toMatchObject({ price: 8000, revision: 2 });
  await ctx.close();
});

test("② 격리: 포항 소속은 강구 화면 404", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@pohang.kr", "pohang");
  const res = await page.goto("/t/gangu/operator/dashboard");
  expect(res?.status()).toBe(404);
  await ctx.close();
});

test("③ 디지털 마감 → 현장 결과 입력 → 개찰 → 통보", async ({ browser, request }) => {
  // 회차 1 마감 시각을 과거로 강제 + tick
  await sql`update rounds set bid_close_at = now() - interval '1 minute', field_start_at = now() - interval '30 seconds' where tenant_id = (select id from tenants where code='gangu') and seq = 1`;
  const tick = await request.post("/api/internal/tick");
  expect(tick.ok()).toBeTruthy();
  await request.post("/api/internal/tick"); // field_open 전이
  const statuses = await sql`select status, count(*)::int as n from auctions where tenant_id=(select id from tenants where code='gangu') group by 1`;
  expect(statuses.every((s) => s.status === "field_open" || s.status === "closed_digital")).toBeTruthy();

  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr");
  await page.goto("/t/gangu/operator/field-result");
  // A01 고등어: 디지털 최고 8,200(김중매·최영수 동일가) vs 현장 8,500 이상철 → 현장 낙찰
  const [r1] = await sql`select id from rounds where tenant_id=(select id from tenants where code='gangu') and seq=1`;
  await page.goto(`/t/gangu/operator/field-result?round=${r1.id}`);
  const card = page.locator(".field-card").filter({ hasText: "A01" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("8,200")).toHaveCount(0); // 입력 전 디지털가 숨김
  await card.getByPlaceholder("예: 8500").fill("8500");
  const optVal = await card.locator("select option", { hasText: "M-205" }).getAttribute("value");
  await card.locator("select").selectOption(optVal!);
  await card.getByRole("button", { name: "현장 결과 확정 · 개찰" }).click();
  await expect(card.getByText("최종 낙찰가")).toBeVisible({ timeout: 15_000 });
  const [a01] = await sql`select a.status, a.final_price, a.award_source, m.license_no from auctions a left join memberships m on m.id = a.winner_membership_id where a.auction_no like '%-A01'`;
  expect(a01).toMatchObject({ status: "awarded", final_price: 8500, award_source: "field", license_no: "M-205" });

  // 나머지 일괄 개찰 (디지털만)
  await page.goto("/t/gangu/operator/results");
  await page.getByRole("button", { name: /전체 일괄 개찰/ }).click();
  await page.getByRole("button", { name: "일괄 개찰", exact: true }).click();
  await expect(page.getByText(/일괄 개찰 완료/)).toBeVisible({ timeout: 30_000 });
  const after = await sql`select status, count(*)::int as n from auctions where tenant_id=(select id from tenants where code='gangu') group by 1 order by 1`;
  const map = Object.fromEntries(after.map((r) => [r.status, r.n]));
  expect(map.awarded).toBeGreaterThanOrEqual(7);   // 입찰 있던 물품
  expect(map.passed).toBeGreaterThanOrEqual(5);    // 입찰 없던 물품 유찰
  expect(map.field_open ?? 0).toBe(0);
  // A02 갈치: 김중매 48,000 디지털 낙찰 / A04 광어 예가 15,000 이상 → 이상철 22,500
  const [a02] = await sql`select final_price, award_source from auctions where auction_no like '%-A02'`;
  expect(a02).toMatchObject({ final_price: 48000, award_source: "digital" });
  // 동일가 A01은 현장이 이겼으므로 first_come 미적용. 통보 확인: 낙찰 알림
  const [{ n }] = await sql`select count(*)::int as n from notifications where type in ('awarded','lost','passed') and created_at > now() - interval '5 minutes'`;
  expect(n).toBeGreaterThan(5);
  const [round] = await sql`select status from rounds where tenant_id=(select id from tenants where code='gangu') and seq=1`;
  expect(round.status).toBe("done");
  await ctx.close();
});

test("④ 정산 생성·확정 → 회계 Mock → 선주/중매인 조회 → 정산서 인쇄 화면", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr");
  await page.goto("/t/gangu/operator/settlement");
  await page.getByRole("button", { name: "정산 생성 / 재계산" }).click();
  await expect(page.getByText(/생성\/재계산 완료/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText("선주별 정산")).toBeVisible();
  await page.getByRole("button", { name: "정산 확정 · 회계 연동" }).click();
  await page.getByRole("button", { name: "확정 · 전송" }).click();
  await expect(page.getByText(/확정/).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const rows = await sql`select party_type, status, gross_amount, fee_amount, net_amount, fee_rate from settlements where tenant_id=(select id from tenants where code='gangu')`;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.status === "confirmed")).toBeTruthy();
  const shipper = rows.filter((r) => r.party_type === "shipper");
  for (const s of shipper) { expect(Number(s.fee_rate)).toBe(0.04); expect(Number(s.net_amount)).toBe(Number(s.gross_amount) - Number(s.fee_amount)); }
  const [{ n: erp }] = await sql`select count(*)::int as n from notification_logs where channel='erp'`;
  expect(erp).toBe(rows.length);
  const [{ n: settled }] = await sql`select count(*)::int as n from auctions where status='settled'`;
  expect(settled).toBeGreaterThan(0);

  // 선주 조회
  const sctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const sp = await login(sctx, "shipper1@gangu.kr");
  await sp.goto("/t/gangu/shipper/settlement");
  await expect(sp.getByText(/지급액/).first()).toBeVisible();
  const [st] = await sql`select s.id from settlements s join users u on u.id = s.party_user_id where u.email='shipper1@gangu.kr' limit 1`;
  const r = await sp.goto(`/t/gangu/print/settlement/${st.id}`);
  expect(r?.status()).toBe(200);
  await expect(sp.getByText(/정산서/).first()).toBeVisible();
  // 다른 선주 정산서 접근 불가
  const [other] = await sql`select s.id from settlements s join users u on u.id = s.party_user_id where u.email='shipper4@gangu.kr' limit 1`;
  if (other) { const r2 = await sp.goto(`/t/gangu/print/settlement/${other.id}`); expect([403, 404]).toContain(r2?.status()); }
  await sctx.close();

  // 중매인 결과·정산
  const bctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const bp = await login(bctx, "broker@gangu.kr");
  await bp.goto("/t/gangu/broker/results");
  await expect(bp.getByText("오늘의 낙찰")).toBeVisible();
  await bp.goto("/t/gangu/broker/settlement");
  await expect(bp.getByText(/청구액/).first()).toBeVisible();
  await bctx.close();
  await ctx.close();
});

test("⑤ 노조는 가격 비노출, Platform Admin 읽기 전용", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const up = await login(ctx, "union@gangu.kr");
  await up.goto("/t/gangu/union");
  const text = await up.locator("body").innerText();
  expect(text).not.toMatch(/8,500원|48,000원|낙찰가/);
  await ctx.close();

  const pctx = await browser.newContext();
  const pp = await login(pctx, "platform@mansun.kr");
  await pp.goto("/t/gangu/operator/results");
  await pp.waitForURL(/\/t\/gangu\//);
  await pp.goto("/t/gangu/operator/results");
  await expect(pp.getByText("읽기 전용 (Platform Admin)")).toBeVisible();
  expect(await pp.getByRole("button", { name: /일괄 개찰/ }).count()).toBe(0);
  await pctx.close();
});
