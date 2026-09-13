import { test, expect } from "@playwright/test";
import { bypass, closeDb, expectToast, kstToday, login, MOBILE, resetRound, sql, type RoundRow } from "./helpers";

/**
 * 입고담당(모바일): 신규 입고 임시 저장 → 확정(경매번호 부여, 회차 2) → 운영자 대시보드/입고 화면 반영 → 오프라인 큐 빈 상태
 * 회차 2 는 beforeAll 에서 예정(scheduled, +2h~+3h) 상태로 리셋한다 (core-cycle 은 회차 1만 사용).
 */
test.describe.configure({ mode: "serial" });

let round2: RoundRow;
let intakeId = "";

test.beforeAll(async () => {
  await bypass();
  round2 = await resetRound(2, { status: "scheduled", startMin: 120, closeMin: 180, fieldMin: 185 });
});
test.afterAll(async () => { await closeDb(); });

test("① 신규 입고 임시 저장 → draft 상세", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "receiver@gangu.kr", "gangu");
  await page.goto("/t/gangu/receiver/new");
  await expect(page.getByRole("heading", { name: "신규 입고" })).toBeVisible();

  // 선박 해랑호
  const vesselSelect = page.locator("select").filter({ has: page.locator("option", { hasText: "해랑호" }) }).first();
  const vesselVal = await vesselSelect.locator("option", { hasText: "해랑호" }).getAttribute("value");
  await vesselSelect.selectOption(vesselVal!);
  // 도착 시각은 기본값 유지 · 회차 2 선택
  const roundSelect = page.locator("select").filter({ has: page.locator(`option[value="${round2.id}"]`) }).first();
  await roundSelect.selectOption(round2.id);

  // 품목 1개: 고등어 · 50kg · kg · B · 참고 e2e
  const lot = page.locator(".lot-editor").first();
  const selects = lot.locator("select");
  await selects.nth(0).selectOption({ label: "고등어" });
  await selects.nth(1).selectOption("B");
  await lot.locator("input[type=number]").first().fill("50");
  await selects.nth(2).selectOption("kg");
  await lot.getByPlaceholder("활어 · 선도 우수").fill("e2e");
  await expect(page.getByText(/물품 \(1개 · 50kg\)/)).toBeVisible();

  await page.getByRole("button", { name: "💾 임시 저장" }).click();
  await page.waitForURL(/\/t\/gangu\/receiver\/intake\/[0-9a-f-]{36}/);
  intakeId = page.url().match(/intake\/([0-9a-f-]{36})/)![1];
  await expect(page.getByText("입고대기")).toBeVisible(); // draft 배지
  await expect(page.getByText("고등어 · B등급")).toBeVisible();

  const [it] = await sql`select status, round_id, vessel_id, (select name from vessels v where v.id = i.vessel_id) as vessel from intakes i where id = ${intakeId}`;
  expect(it).toMatchObject({ status: "draft", round_id: round2.id, vessel: "해랑호" });
  const lots = await sql`select status, auction_no, species_code, weight_kg, unit, grade, note from auctions where intake_id = ${intakeId}`;
  expect(lots).toHaveLength(1);
  expect(lots[0]).toMatchObject({ status: "registered", auction_no: null, species_code: "mackerel", weight_kg: 50, unit: "kg", grade: "B", note: "e2e" });
  await ctx.close();
});

test("② 확정 → confirmed · 경매번호 B01 (회차 2)", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "receiver@gangu.kr", "gangu");
  await page.goto(`/t/gangu/receiver/intake/${intakeId}`);
  await page.getByRole("button", { name: "✅ 확정" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("입고 확정")).toBeVisible();
  await dialog.locator("select").selectOption(round2.id);
  await dialog.getByRole("button", { name: "확정", exact: true }).click();
  await expectToast(page, /확정 완료/);
  await expect(page.getByText("확정된 입고입니다")).toBeVisible({ timeout: 15_000 });

  const [it] = await sql`select status, confirmed_at, confirmed_by from intakes where id = ${intakeId}`;
  expect(it.status).toBe("confirmed"); // 회차 scheduled → confirmed
  expect(it.confirmed_at).not.toBeNull();
  const [lot] = await sql`select status, auction_no from auctions where intake_id = ${intakeId}`;
  expect(lot.auction_no).toBe(`gangu-${kstToday().replace(/-/g, "")}-B01`);
  expect(lot.status).toBe("registered");
  // 운영자 알림
  const [{ n }] = await sql`select count(*)::int as n from notifications where type = 'intake_new' and title = '새 입고: 해랑호' and link like ${"%" + intakeId}`;
  expect(n).toBeGreaterThan(0);
  await ctx.close();
});

test("③ 운영자 대시보드 · 입고 화면에 반영", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr", "gangu");
  await page.goto("/t/gangu/operator/dashboard");
  const row = page.locator("table.data-table tbody tr").filter({ hasText: "해랑호" }).filter({ hasText: "2회차" });
  await expect(row.first()).toBeVisible();
  await expect(row.first()).toContainText("입고완료");

  await page.goto(`/t/gangu/operator/intake?intake=${intakeId}`);
  await expect(page.locator(".intake-list a.active")).toContainText("해랑호");
  await expect(page.getByText(`gangu-${kstToday().replace(/-/g, "")}-B01`)).toBeVisible();
  await expect(page.getByRole("heading", { name: /선박 정보/ })).toContainText("입고완료");
  await ctx.close();
});

test("④ 오프라인 큐 화면 — 대기 0건", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "receiver@gangu.kr", "gangu");
  await page.goto("/t/gangu/receiver/offline-queue");
  await expect(page.getByText(/동기화 대기 0건/)).toBeVisible();
  await expect(page.getByText("동기화 대기 중인 입고가 없습니다")).toBeVisible();
  await ctx.close();
});
