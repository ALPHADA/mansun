import { test, expect } from "@playwright/test";
import { bypass, closeDb, login, MOBILE, sql, tenantId, todayRound, userId } from "./helpers";

/**
 * 수협 정책 스위치: 입찰 MFA(OTP) · 입찰 수정 불가 · 낙찰자 익명 공개
 * 전제: z2 가 회차 2 물품에 김중매 입찰(9,000) 을 남겨 둔 상태(open), z4/core-cycle 로 김중매 패찰 카드가 존재.
 */
test.describe.configure({ mode: "serial" });

let tid = "";
let lotId = "";
let brokerUid = "";

async function setPolicy(patch: { mfa?: boolean; modify?: boolean; disclosure?: "license_no" | "anonymous" }) {
  if (patch.mfa !== undefined) await sql`update tenants set bid_mfa_required = ${patch.mfa} where id = ${tid}`;
  if (patch.modify !== undefined) await sql`update tenants set bid_modification_allowed = ${patch.modify} where id = ${tid}`;
  if (patch.disclosure !== undefined) await sql`update tenants set winner_disclosure = ${patch.disclosure} where id = ${tid}`;
}

test.beforeAll(async () => {
  await bypass();
  tid = await tenantId("gangu");
  brokerUid = await userId("broker@gangu.kr");
  const r2 = await todayRound(2);
  if (!r2) throw new Error("회차 2 가 없습니다 — z1/z2 를 먼저 실행하세요");
  const [lot] = await sql`select a.id from auctions a join bids b on b.auction_id = a.id where a.round_id = ${r2.id} and a.status in ('open','closing') and b.broker_user_id = ${brokerUid} and b.status = 'submitted' limit 1`;
  if (!lot) throw new Error("회차 2 에 김중매 입찰이 있는 open 물품이 없습니다 — z2 를 먼저 실행하세요");
  lotId = lot.id;
  await setPolicy({ mfa: false, modify: true, disclosure: "license_no" });
});
test.afterAll(async () => {
  await setPolicy({ mfa: false, modify: true, disclosure: "license_no" });
  await closeDb();
});

test("① bid_mfa_required → OTP 인증 후 입찰 수정", async ({ browser }) => {
  await setPolicy({ mfa: true });
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "broker@gangu.kr", "gangu");
  await page.goto(`/t/gangu/broker/bid/${lotId}`);
  await expect(page.getByText(/본인 인증\(OTP\)/)).toBeVisible();
  await page.getByLabel("입찰가").fill("9500");
  await page.getByRole("button", { name: "🔨 입찰 수정하기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("입찰 수정 확인");
  await dialog.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(dialog).toContainText("본인 인증");
  await expect(dialog.locator(".dev-code")).toContainText("000000");
  const [otp] = await sql`select code, used_at from otp_codes where target = ${`bid:${brokerUid}`} and purpose = 'bid' order by created_at desc limit 1`;
  expect(otp.code).toBe("000000");
  expect(otp.used_at).toBeNull();
  await dialog.locator(".otp-box input").fill("000000");
  await dialog.getByRole("button", { name: "인증 후 입찰" }).click();
  await page.waitForURL(/broker\/results/);
  const [bid] = await sql`select price, revision from bids where auction_id = ${lotId} and broker_user_id = ${brokerUid}`;
  expect(bid).toMatchObject({ price: 9500, revision: 2 });
  const [used] = await sql`select used_at from otp_codes where target = ${`bid:${brokerUid}`} and purpose = 'bid' order by created_at desc limit 1`;
  expect(used.used_at).not.toBeNull();
  await setPolicy({ mfa: false });
  await ctx.close();
});

test("② bid_modification_allowed=false → 입찰 완료 (수정 불가)", async ({ browser }) => {
  await setPolicy({ modify: false });
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "broker@gangu.kr", "gangu");
  await page.goto(`/t/gangu/broker/bid/${lotId}`);
  await expect(page.getByText(/1회 확정 \(수정 불가\)/)).toBeVisible();
  const btn = page.getByRole("button", { name: "입찰 완료 (수정 불가)" });
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();
  await expect(page.getByLabel("입찰가")).toBeDisabled();
  await setPolicy({ modify: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "🔨 입찰 수정하기" })).toBeEnabled();
  await ctx.close();
});

test("③ winner_disclosure=anonymous → 패찰 카드 낙찰자 '비공개'", async ({ browser }) => {
  const [{ n }] = await sql`select count(*)::int as n from bids b join auctions a on a.id = b.auction_id where b.broker_user_id = ${brokerUid} and b.status = 'lost' and a.status in ('awarded','settled') and a.winner_membership_id is not null`;
  expect(n, "김중매 패찰 카드가 없습니다 (z4 또는 core-cycle 선행 필요)").toBeGreaterThan(0);

  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "broker@gangu.kr", "gangu");
  await page.goto("/t/gangu/broker/results?f=lost");
  const lost = page.locator(".result-card.lost").filter({ hasText: "패찰" });
  await expect(lost.first()).toBeVisible();
  await expect(lost.first()).toContainText(/면허 [A-Z]-\d+/);

  await setPolicy({ disclosure: "anonymous" });
  await page.reload();
  const text = await page.locator(".mobile-content").innerText();
  expect(text).toContain("비공개");
  expect(text).not.toMatch(/면허 [A-Z]-\d+/);

  await setPolicy({ disclosure: "license_no" });
  await page.reload();
  await expect(page.locator(".result-card.lost").filter({ hasText: "패찰" }).first()).toContainText(/면허 [A-Z]-\d+/);
  await ctx.close();
});
