import { test, expect } from "@playwright/test";
import { bypass, closeDb, expectToast, kstToday, login, MOBILE, sql, tenantId, todayRound, userId, type RoundRow } from "./helpers";

/**
 * 노조(가격 비노출·주간 일정·CSV·회차 알림 구독) · 선주(선박/마이페이지/알림 설정) · 중매인 다중 소속 전환 · 알림함 전체 수협 범위
 */
test.describe.configure({ mode: "serial" });

let tid = "";
let unionUid = "";
let round1: RoundRow;

test.beforeAll(async () => {
  await bypass();
  tid = await tenantId("gangu");
  unionUid = await userId("union@gangu.kr");
  const r = (await todayRound(1)) ?? (await sql`select id, seq, status, label, date::text as date from rounds where tenant_id = ${tid} and date = ${kstToday()} order by seq limit 1`)[0] as RoundRow | undefined;
  if (!r) throw new Error("오늘 회차가 없습니다 (시드 필요)");
  round1 = r;
  await sql`delete from round_subscriptions where user_id = ${unionUid}`;
});
test.afterAll(async () => { await closeDb(); });

test("① 노조 주간 일정 — 7일 그리드 · 오늘 회차", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "union@gangu.kr", "gangu");
  await page.goto("/t/gangu/union/schedule");
  await expect(page.locator(".cal-grid.week .cal-day")).toHaveCount(7);
  const today = page.locator(".cal-day.today");
  await expect(today).toHaveCount(1);
  await expect(today.locator(".dow")).toContainText("오늘");
  const [{ n }] = await sql`select count(*)::int as n from rounds where tenant_id = ${tid} and date = ${kstToday()}`;
  expect(await today.locator(".cal-item").count()).toBeGreaterThanOrEqual(Math.min(1, n));
  await expect(today.locator(".cal-item").first()).toContainText(/\d회차 \d{2}:\d{2} 마감/);
  await ctx.close();
});

test("② 회차 상세 — 어종 요약(가격 없음) · CSV(BOM) · 알림 구독 토글", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "union@gangu.kr", "gangu");
  await page.goto(`/t/gangu/union/schedule/${round1.id}`);
  await expect(page.getByRole("heading", { name: round1.label })).toBeVisible();
  await expect(page.locator(".mini-table")).toBeVisible();
  await expect(page.locator(".mini-table tbody tr").first()).toBeVisible();
  const text = await page.locator(".mobile-content").innerText();
  expect(text).not.toMatch(/[\d,]+원/); // 어떤 금액도 노출되지 않음

  // CSV export (세션 쿠키 사용)
  const res = await page.request.get(`/t/gangu/union/schedule/${round1.id}/export`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.body();
  expect([body[0], body[1], body[2]]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = body.toString("utf8");
  expect(csv).toContain("어종,코드,단위,건수,수량,중량kg,환산kg");
  expect(csv).toContain("순번,선박,도착시각");
  expect(csv).not.toMatch(/[\d,]+원/);
  const [{ n: exportLogs }] = await sql`select count(*)::int as n from audit_logs where tenant_id = ${tid} and action = 'union.export_csv' and target_id = ${round1.id}`;
  expect(exportLogs).toBeGreaterThan(0);

  // 구독 토글
  const btn = page.locator(".btn-sub");
  await expect(btn).toHaveText(/이 회차 알림 받기/);
  await btn.click();
  await expectToast(page, /이 회차 알림을 받습니다/);
  await expect(btn).toHaveText(/알림 받는 중/);
  const [{ n: subs }] = await sql`select count(*)::int as n from round_subscriptions where round_id = ${round1.id} and user_id = ${unionUid}`;
  expect(subs).toBe(1);
  await page.reload();
  await expect(page.locator(".btn-sub")).toHaveText(/알림 받는 중/);
  await page.locator(".btn-sub").click();
  await expectToast(page, /회차 알림을 해제했습니다/);
  await expect(page.locator(".btn-sub")).toHaveText(/이 회차 알림 받기/);
  const [{ n: subs2 }] = await sql`select count(*)::int as n from round_subscriptions where round_id = ${round1.id} and user_id = ${unionUid}`;
  expect(subs2).toBe(0);
  await ctx.close();
});

test("③ 선주 — 선박 목록 · 입금 계좌 변경 · 알림 설정 토글", async ({ browser }) => {
  const shipperUid = await userId("shipper1@gangu.kr");
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "shipper1@gangu.kr", "gangu");
  await page.goto("/t/gangu/shipper/vessels");
  const card = page.locator(".vessel-card").filter({ hasText: "제3만선호" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("GG-0301");
  await expect(page.getByText(/선주 화면에서는 조회만 가능/)).toBeVisible();

  await page.goto("/t/gangu/shipper/my");
  const bankRow = page.locator(".detail-row").filter({ hasText: "입금 계좌" });
  await bankRow.getByRole("button", { name: "수정" }).click();
  const input = page.locator(".inline-edit input");
  await input.fill("수협 101-9999-0000 (박성진)");
  await page.locator(".inline-edit").getByRole("button", { name: "저장" }).click();
  await expectToast(page, "프로필을 저장했습니다");
  await expect(page.locator(".detail-row").filter({ hasText: "입금 계좌" })).toContainText("수협 101-9999-0000 (박성진)");
  const [u] = await sql`select bank_account from users where id = ${shipperUid}`;
  expect(u.bank_account).toBe("수협 101-9999-0000 (박성진)");

  // 알림 설정: SMS 토글 → 저장 → 새로고침 유지 → 복원
  const sw = page.getByRole("switch", { name: "SMS" });
  const before = (await sw.getAttribute("aria-checked")) === "true";
  await sw.click();
  await expectToast(page, "알림 설정을 저장했습니다");
  await expect(sw).toHaveAttribute("aria-checked", String(!before));
  await page.reload();
  await expect(page.getByRole("switch", { name: "SMS" })).toHaveAttribute("aria-checked", String(!before));
  const [m] = await sql`select notification_prefs->>'sms' as sms from memberships where user_id = ${shipperUid} and tenant_id = ${tid} and role = 'shipper'`;
  expect(m.sms).toBe(String(!before));
  await page.getByRole("switch", { name: "SMS" }).click();
  await expectToast(page, "알림 설정을 저장했습니다");
  await expect(page.getByRole("switch", { name: "SMS" })).toHaveAttribute("aria-checked", String(before));
  const [m2] = await sql`select notification_prefs->>'sms' as sms from memberships where user_id = ${shipperUid} and tenant_id = ${tid} and role = 'shipper'`;
  expect(m2.sms).toBe(String(before));
  await ctx.close();
});

test("④ 중매인 다중 소속 — 헤더 칩 전환 → 포항 · 알림함 전체 수협", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "broker@gangu.kr", "gangu");
  await page.goto("/t/gangu/broker/auctions");
  const chip = page.locator("header .tenant-chip");
  await expect(chip).toContainText("강구항 수협");
  await expect(chip).toContainText("▾");
  await chip.click();
  const menu = page.locator(".dropdown-menu");
  await expect(menu.getByRole("button", { name: /강구항 수협/ })).toHaveClass(/current/);
  await menu.getByRole("button", { name: /포항 수협/ }).click();
  await page.waitForURL(/\/t\/pohang\/broker\/auctions/);
  await expect(page.locator("header .tenant-chip")).toContainText("포항 수협");
  await expect(page.getByText("진행중인 경매가 없습니다")).toBeVisible();
  const [{ n }] = await sql`select count(*)::int as n from audit_logs where action = 'auth.select_tenant' and tenant_id = (select id from tenants where code = 'pohang') and actor_user_id = (select id from users where email = 'broker@gangu.kr')`;
  expect(n).toBeGreaterThan(0);

  // 알림함 — 현재 수협 vs 전체 수협
  await page.goto("/t/pohang/notifications");
  await expect(page.locator(".tabs a.active")).toHaveText("포항 수협");
  await expect(page.locator(".notif-meta .badge").filter({ hasText: "강구항 수협" })).toHaveCount(0);
  await page.goto("/t/pohang/notifications?scope=all");
  await expect(page.locator(".tabs a.active")).toHaveText("전체 수협");
  await expect(page.locator(".notif-meta .badge").filter({ hasText: "강구항 수협" }).first()).toBeVisible();
  await expect(page.locator(".notif-meta .badge").filter({ hasText: "포항 수협" }).first()).toBeVisible();
  await ctx.close();
});
