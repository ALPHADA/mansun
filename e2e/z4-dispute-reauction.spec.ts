import { test, expect } from "@playwright/test";
import { brokerMembership, bypass, closeDb, deleteRoundData, expectToast, kstToday, login, MOBILE, pollDb, sql, tenantId, tickUntil, todayRound, userId } from "./helpers";

/**
 * 재개찰/분쟁 사이클 — 회차 3(SQL 생성) 의 C01 고등어(제3만선호): 김중매·박철수 동일가 5,000 (박철수 선제출)
 * 마감(tick) → 운영자 '디지털만으로 개찰' → 박철수 선착순 낙찰 → 재개찰 신청 → Admin 승인 → 재개찰(attempt 2) → 선주 이의 제기
 */
test.describe.configure({ mode: "serial" });

let tid = "";
let round3Id = "";
let intakeId = "";
let auctionId = "";
let auctionNo = "";
let kim: { id: string; licenseNo: string };
let park: { id: string; licenseNo: string };

test.beforeAll(async () => {
  await bypass();
  tid = await tenantId("gangu");
  const today = kstToday();
  auctionNo = `gangu-${today.replace(/-/g, "")}-C01`;
  const existing = await todayRound(3);
  if (existing) { await deleteRoundData(existing.id); await sql`delete from rounds where id = ${existing.id}`; }
  await sql`delete from auctions where auction_no = ${auctionNo}`; // 혹시 남은 번호 충돌 방지
  const [r] = await sql`insert into rounds (tenant_id, date, seq, label, bid_start_at, bid_close_at, field_start_at, status, auto_noticed_at)
    values (${tid}, ${today}, 3, ${`${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} e2e 3회차`}, now() - interval '10 minutes', now() + interval '30 minutes', now() + interval '35 minutes', 'in_progress', now()) returning id`;
  round3Id = r.id;
  const [v] = await sql`select id from vessels where tenant_id = ${tid} and name = '제3만선호'`;
  const recv = await userId("receiver@gangu.kr");
  const op = await userId("operator@gangu.kr");
  const [it] = await sql`insert into intakes (tenant_id, vessel_id, round_id, arrived_at, status, created_by, confirmed_at, confirmed_by, note)
    values (${tid}, ${v.id}, ${round3Id}, now() - interval '20 minutes', 'announced', ${recv}, now() - interval '15 minutes', ${op}, 'e2e 재개찰 시나리오') returning id`;
  intakeId = it.id;
  const [a] = await sql`insert into auctions (tenant_id, intake_id, round_id, auction_no, tank_no, species_code, weight_kg, unit, quantity, grade, note, status, bid_count)
    values (${tid}, ${intakeId}, ${round3Id}, ${auctionNo}, 'T-E2E', 'mackerel', 100, 'kg', 100, 'A', 'e2e', 'open', 2) returning id`;
  auctionId = a.id;
  kim = await brokerMembership("broker@gangu.kr");
  park = await brokerMembership("park@gangu.kr");
  const kimU = await userId("broker@gangu.kr");
  const parkU = await userId("park@gangu.kr");
  await sql`insert into bids (tenant_id, auction_id, broker_membership_id, broker_user_id, price, submitted_at, first_submitted_at, ip)
    values (${tid}, ${auctionId}, ${park.id}, ${parkU}, 5000, now() - interval '5 minutes', now() - interval '5 minutes', 'e2e'),
           (${tid}, ${auctionId}, ${kim.id}, ${kimU}, 5000, now() - interval '3 minutes', now() - interval '3 minutes', 'e2e')`;
});
test.afterAll(async () => { await closeDb(); });

test("① 회차 3 마감(tick) → field_open", async ({ request }) => {
  await sql`update rounds set bid_close_at = now() - interval '1 minute', field_start_at = now() - interval '30 seconds' where id = ${round3Id}`;
  await tickUntil(request, async () => {
    const [a] = await sql`select status from auctions where id = ${auctionId}`;
    return a.status === "field_open";
  });
  const [a] = await sql`select status, digital_high_price from auctions where id = ${auctionId}`;
  expect(a).toMatchObject({ status: "field_open", digital_high_price: 5000 });
  const [r] = await sql`select status from rounds where id = ${round3Id}`;
  expect(r.status).toBe("auctioning");
});

test("② 운영자 개찰(디지털만) → 박철수 선착순 낙찰", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr", "gangu");
  await page.goto(`/t/gangu/operator/results?round=${round3Id}`);
  const row = page.locator("table.data-table tbody tr").filter({ hasText: auctionNo });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("현장 경매중");
  await expect(row).toContainText("🔒 비공개"); // 개찰 전 디지털가 숨김
  await row.getByRole("button", { name: "개찰", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`디지털만으로 개찰 · ${auctionNo}`);
  await dialog.getByRole("button", { name: "디지털만으로 개찰" }).click();
  await expectToast(page, /개찰 완료/);

  const a = await pollDb(async () => (await sql`select a.status, a.final_price, a.award_source, m.license_no from auctions a left join memberships m on m.id = a.winner_membership_id where a.id = ${auctionId}`)[0], (x) => x.status === "awarded");
  expect(a).toMatchObject({ status: "awarded", final_price: 5000, award_source: "digital", license_no: park.licenseNo });
  const [res] = await sql`select attempt, is_current, outcome, tie_break from auction_results where auction_id = ${auctionId} order by attempt desc limit 1`;
  expect(res).toMatchObject({ attempt: 1, is_current: true, outcome: "awarded", tie_break: "first_come" });
  const bids = await sql`select b.status, m.license_no from bids b join memberships m on m.id = b.broker_membership_id where b.auction_id = ${auctionId} order by m.license_no`;
  expect(bids).toEqual([{ status: "awarded", license_no: park.licenseNo }, { status: "lost", license_no: kim.licenseNo }].sort((x, y) => x.license_no.localeCompare(y.license_no)));
  const [{ n }] = await sql`select count(*)::int as n from notifications where type in ('awarded','lost') and title like ${"%" + auctionNo}`;
  expect(n).toBeGreaterThanOrEqual(3); // 낙찰자 · 패찰자 · 선주
  await expect(page.locator("table.data-table tbody tr").filter({ hasText: auctionNo })).toContainText("박철수");
  await ctx.close();
});

test("③ 재개찰 신청 → 분쟁 open · 물품 disputed", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr", "gangu");
  await page.goto(`/t/gangu/operator/results?round=${round3Id}`);
  const row = page.locator("table.data-table tbody tr").filter({ hasText: auctionNo });
  await row.getByRole("button", { name: "재개찰 신청" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`재개찰 신청 · ${auctionNo}`);
  await expect(dialog.getByRole("button", { name: "신청", exact: true })).toBeDisabled();
  await dialog.locator("textarea").fill("e2e 분쟁 사유 테스트");
  await dialog.getByRole("button", { name: "신청", exact: true }).click();
  await expectToast(page, /재개찰 신청 완료/);

  const [d] = await sql`select kind, status, reason, raised_role from disputes where auction_id = ${auctionId} order by created_at desc limit 1`;
  expect(d).toMatchObject({ kind: "reauction", status: "open", reason: "e2e 분쟁 사유 테스트", raised_role: "operator" });
  const [a] = await sql`select status from auctions where id = ${auctionId}`;
  expect(a.status).toBe("disputed");
  const [{ n }] = await sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.email = 'admin@gangu.kr' and n.type = 'dispute' and n.title = ${`재개찰 승인 요청 · ${auctionNo}`}`;
  expect(n).toBe(1);
  await expect(page.locator("table.data-table tbody tr").filter({ hasText: auctionNo }).first()).toContainText("분쟁");
  await ctx.close();
});

test("④ Admin 승인 → 결과 무효화 · closed_digital", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@gangu.kr", "gangu");
  await page.goto("/t/gangu/admin");
  const card = page.locator(".dispute-card").filter({ hasText: auctionNo });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("재개찰 신청");
  await expect(card).toContainText("e2e 분쟁 사유 테스트");
  await card.getByPlaceholder("처리 의견 (선택)").fill("e2e 승인");
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "승인" }).click();
  await expectToast(page, /승인했습니다/);

  const [d] = await sql`select status, decision_note, decided_at from disputes where auction_id = ${auctionId} and kind = 'reauction'`;
  expect(d.status).toBe("approved");
  expect(d.decision_note).toBe("e2e 승인");
  expect(d.decided_at).not.toBeNull();
  const [a] = await sql`select status, final_price, winner_membership_id, award_source from auctions where id = ${auctionId}`;
  expect(a).toMatchObject({ status: "closed_digital", final_price: null, winner_membership_id: null, award_source: null });
  const results = await sql`select is_current from auction_results where auction_id = ${auctionId}`;
  expect(results).toHaveLength(1);
  expect(results.every((r) => r.is_current === false)).toBeTruthy();
  const [r] = await sql`select status from rounds where id = ${round3Id}`;
  expect(r.status).toBe("auctioning");
  await expect(page.locator(".dispute-card").filter({ hasText: auctionNo })).toHaveCount(0);
  await ctx.close();
});

test("⑤ 재개찰(디지털만) → attempt 2 낙찰", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "operator@gangu.kr", "gangu");
  await page.goto(`/t/gangu/operator/results?round=${round3Id}`);
  const row = page.locator("table.data-table").first().locator("tbody tr").filter({ hasText: auctionNo }).first();
  await expect(row).toContainText("개찰 대기");
  await row.getByRole("button", { name: "개찰", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "디지털만으로 개찰" }).click();
  await expectToast(page, /개찰 완료/);
  const a = await pollDb(async () => (await sql`select a.status, a.final_price, m.license_no from auctions a left join memberships m on m.id = a.winner_membership_id where a.id = ${auctionId}`)[0], (x) => x.status === "awarded");
  expect(a).toMatchObject({ status: "awarded", final_price: 5000, license_no: park.licenseNo });
  const results = await sql`select attempt, is_current, outcome from auction_results where auction_id = ${auctionId} order by attempt`;
  expect(results).toEqual([{ attempt: 1, is_current: false, outcome: "awarded" }, { attempt: 2, is_current: true, outcome: "awarded" }]);
  const [r] = await sql`select status from rounds where id = ${round3Id}`;
  expect(r.status).toBe("done");
  await ctx.close();
});

test("⑥ 선주 이의 제기 → objection 분쟁 · 운영자 알림", async ({ browser }) => {
  const ctx = await browser.newContext(MOBILE);
  const page = await login(ctx, "shipper1@gangu.kr", "gangu");
  await page.goto(`/t/gangu/shipper/intake/${intakeId}`);
  await expect(page.getByRole("heading", { name: /제3만선호/ })).toBeVisible();
  const lot = page.locator(".lot-row").filter({ hasText: auctionNo });
  await expect(lot).toContainText("낙찰");
  await expect(lot).toContainText(park.licenseNo); // 낙찰자 면허번호 공개
  await lot.getByRole("button", { name: "이의 제기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("24시간 이내");
  await expect(dialog.getByRole("button", { name: "이의 제기 접수" })).toBeDisabled();
  await dialog.locator("textarea").fill("e2e 선주 이의 제기 사유");
  await dialog.getByRole("button", { name: "이의 제기 접수" }).click();
  await expectToast(page, /이의 제기가 접수되었습니다/);

  const [d] = await sql`select kind, status, reason, raised_role from disputes where auction_id = ${auctionId} and kind = 'objection'`;
  expect(d).toMatchObject({ kind: "objection", status: "open", reason: "e2e 선주 이의 제기 사유", raised_role: "shipper" });
  const [{ n }] = await sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.email = 'operator@gangu.kr' and n.type = 'dispute' and n.title = ${`선주 이의 제기 · ${auctionNo}`}`;
  expect(n).toBe(1);
  await expect(page.locator(".lot-row").filter({ hasText: auctionNo }).locator(".dispute-note").filter({ hasText: "e2e 선주 이의 제기 사유" })).toContainText("검토중");
  await expect(page.locator(".lot-row").filter({ hasText: auctionNo }).getByRole("button", { name: "이의 제기" })).toHaveCount(0);
  await ctx.close();
});
