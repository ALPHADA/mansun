import { test, expect } from "@playwright/test";
import { bypass, closeDb, expectToast, login, MOBILE, pollDb, sql, tickUntil, todayRound, type RoundRow } from "./helpers";

/**
 * 운영자 수동 공지(회차 2) → 알림/발송 로그 → 중매인 알림함·경매 목록(시작 전) → 입찰 시작(tick) → 입찰
 * 전제: z1 이 회차 2(예정, 시작 +2h) 에 해랑호 입고를 확정해 둔 상태.
 */
test.describe.configure({ mode: "serial" });

let round2: RoundRow;
let startedAt: Date;

test.beforeAll(async () => {
  await bypass();
  const r = await todayRound(2);
  if (!r) throw new Error("회차 2 가 없습니다 — z1-receiver-intake 를 먼저 실행하세요");
  round2 = r;
  startedAt = new Date();
});
test.afterAll(async () => { await closeDb(); });

test("① 운영자 수동 공지 발송 (선주 제외)", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr", "gangu");
  await page.goto(`/t/gangu/operator/notice?round=${round2.id}`);
  await expect(page.getByRole("heading", { name: /공지 작성/ })).toContainText(round2.label);
  // 수동 모드 확인
  const manual = page.locator(".toggle-row button", { hasText: "수동" });
  if (!(await manual.evaluate((el) => el.classList.contains("active")))) await manual.click();
  await expect(manual).toHaveClass(/active/);
  // 제목 기본값
  const title = page.locator("input[maxlength='40']");
  await expect(title).toHaveValue(/경매 공지$/);
  const titleText = await title.inputValue();
  // 선주 체크 해제
  const shipper = page.locator(".checkbox-row label", { hasText: /^\s*선주/ }).locator("input[type=checkbox]");
  if (await shipper.isChecked()) await shipper.uncheck();
  await expect(shipper).not.toBeChecked();
  await expect(page.locator(".checkbox-row label", { hasText: /^\s*중매인/ }).locator("input[type=checkbox]")).toBeChecked();

  await page.getByRole("button", { name: "📤 공지 발송" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("명에게 발송합니다");
  await dialog.getByRole("button", { name: "발송", exact: true }).click();
  await expectToast(page, /공지 발송 완료/);
  // 이력 행
  const hist = page.locator("table.data-table tbody tr").filter({ hasText: titleText }).filter({ hasText: "수동" });
  await expect(hist.first()).toBeVisible({ timeout: 15_000 });
  await expect(hist.first()).toContainText("중매인, 노조, 수협 직원");

  // DB
  const [notice] = await sql`select mode, title, targets, channels, lot_count, recipient_count, success_count from notices where round_id = ${round2.id} and sent_at >= ${startedAt} order by sent_at desc limit 1`;
  expect(notice).toBeTruthy();
  expect(notice.mode).toBe("manual");
  expect(notice.title).toBe(titleText);
  expect(notice.targets).toEqual(["broker", "union", "staff"]);
  expect(notice.channels).toEqual(expect.arrayContaining(["inapp", "kakao"]));
  expect(notice.lot_count).toBeGreaterThanOrEqual(1);
  const [{ n: nn }] = await sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.email = 'broker@gangu.kr' and n.type = 'notice' and n.title = ${titleText} and n.created_at >= ${startedAt}`;
  expect(nn).toBe(1);
  const [{ n: kakao }] = await sql`select count(*)::int as n from notification_logs where channel = 'kakao' and subject = ${titleText} and created_at >= ${startedAt}`;
  expect(kakao).toBeGreaterThan(0);
  const [{ n: shipperN }] = await sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.email = 'shipper4@gangu.kr' and n.title = ${titleText}`;
  expect(shipperN).toBe(0);
  const [r] = await sql`select status from rounds where id = ${round2.id}`;
  expect(r.status).toBe("announced");
  const lots = await sql`select status from auctions where round_id = ${round2.id}`;
  expect(lots.length).toBeGreaterThanOrEqual(1);
  expect(lots.every((l) => l.status === "announced")).toBeTruthy();
  await ctx.close();
});

test("② 중매인 알림함 → 링크 이동 · 경매 목록 '시작 전'", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "broker@gangu.kr", "gangu");
  const [notice] = await sql`select title from notices where round_id = ${round2.id} order by sent_at desc limit 1`;
  await page.goto("/t/gangu/notifications");
  const item = page.locator(".notif-item").filter({ hasText: notice.title }).first();
  await expect(item).toBeVisible();
  await expect(item).toHaveClass(/unread/);
  await item.click();
  // link=/t/gangu → 역할 홈으로 리다이렉트
  await page.waitForURL(/\/t\/gangu\/broker\/auctions/);
  const [{ n }] = await sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.email = 'broker@gangu.kr' and n.title = ${notice.title} and n.read_at is not null`;
  expect(n).toBe(1);

  const card = page.locator(".auction-card").filter({ hasText: "해랑호" }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/muted/);
  await expect(card.locator(".countdown")).toHaveText("시작 전");
  await card.click();
  await page.waitForURL(/broker\/bid\//);
  await expect(page.getByRole("button", { name: "시작 전" })).toBeDisabled();
  await expect(page.getByText(/시작 전 \(\d{2}:\d{2} 시작\)/)).toBeVisible();
  await ctx.close();
});

test("③ 입찰 시작(tick) → 카운트다운 → 9,000 입찰", async ({ browser, request }) => {
  await sql`update rounds set bid_start_at = now() - interval '1 minute' where id = ${round2.id}`;
  await tickUntil(request, async () => {
    const [r] = await sql`select status from rounds where id = ${round2.id}`;
    return r.status === "in_progress";
  });
  const lots = await pollDb(() => sql`select id, status, quantity from auctions where round_id = ${round2.id} order by auction_no`, (ls) => ls.length > 0 && ls.every((l) => l.status === "open"));
  expect(lots.every((l) => l.status === "open")).toBeTruthy();
  const lot = lots[0];

  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "broker@gangu.kr", "gangu");
  await page.goto("/t/gangu/broker/auctions");
  await expect(page.getByText("🟢 LIVE")).toBeVisible();
  const card = page.locator(".auction-card").filter({ hasText: "해랑호" }).first();
  await expect(card).not.toHaveClass(/muted/);
  await expect(card.locator(".countdown")).toHaveText(/⏱ \d+:\d{2}/);

  await page.goto(`/t/gangu/broker/bid/${lot.id}`);
  await page.getByLabel("입찰가").fill("9000");
  await expect(page.getByText(new RegExp(`${(9000 * Number(lot.quantity)).toLocaleString("ko-KR")}원`))).toBeVisible();
  await page.getByRole("button", { name: "🔨 입찰하기" }).click();
  await page.getByRole("button", { name: "입찰하기", exact: true }).click();
  await page.waitForURL(/broker\/results/);
  const [bid] = await sql`select b.price, b.revision, b.status, u.email from bids b join users u on u.id = b.broker_user_id where b.auction_id = ${lot.id}`;
  expect(bid).toMatchObject({ price: 9000, revision: 1, status: "submitted", email: "broker@gangu.kr" });
  const [a] = await sql`select bid_count from auctions where id = ${lot.id}`;
  expect(a.bid_count).toBe(1);
  await expect(page.locator(".result-card").filter({ hasText: "해랑호" }).first()).toContainText("입찰중");
  await ctx.close();
});
