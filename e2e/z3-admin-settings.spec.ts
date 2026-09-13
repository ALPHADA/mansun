import { test, expect } from "@playwright/test";
import { bypass, closeDb, expectToast, kstToday, login, PASSWORD, sql, tenantId } from "./helpers";

/**
 * 수협 Admin: 설정 잠금(활성 경매 중) · 일반 설정 저장/감사 · 멤버 초청 → 초청 수락(OTP) → 실제 로그인 · 면허 만료 임박/갱신
 * 전제: z2 가 회차 2 물품을 입찰중(open) 으로 만들어 둔 상태 (잠금 배너 조건).
 */
test.describe.configure({ mode: "serial" });

const INVITE_EMAIL = "invite-e2e@example.com";
const startedAt = new Date();
let tid = "";

async function cleanupInvitee() {
  const [u] = await sql`select id from users where email = ${INVITE_EMAIL}`;
  if (u) {
    await sql`delete from notifications where user_id = ${u.id}`;
    await sql`delete from memberships where user_id = ${u.id}`;
    await sql`delete from users where id = ${u.id}`;
  }
  await sql`delete from invitations where email = ${INVITE_EMAIL}`;
  await sql`delete from otp_codes where target = ${INVITE_EMAIL}`;
}

test.beforeAll(async () => {
  await bypass();
  tid = await tenantId("gangu");
  await cleanupInvitee();
  // 이상철(M-205) 면허: 5일 뒤 만료(시드와 동일) — 재실행에도 '만료 임박' 을 보장
  await sql`update memberships set license_expires_at = (${kstToday()}::date + 5), license_status = 'active'
    where tenant_id = ${tid} and role = 'broker' and license_no = 'M-205'`;
  const [{ n }] = await sql`select count(*)::int as n from auctions where tenant_id = ${tid} and status in ('open','closing','closed_digital','field_open','rebid')`;
  if (n === 0) throw new Error("활성 경매가 없습니다 — z2-notice-and-broker 를 먼저 실행하세요 (잠금 배너 전제)");
});
test.afterAll(async () => { await closeDb(); });

test("① 수수료 탭 — 활성 경매 중 잠금", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@gangu.kr", "gangu");
  await page.goto("/t/gangu/admin/settings?tab=fees");
  await expect(page.locator(".lock-banner")).toContainText("활성 경매가 진행 중입니다");
  const numbers = page.locator("form.settings-form input[type=number]");
  await expect(numbers).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(numbers.nth(i)).toBeDisabled();
  await expect(page.getByLabel(/수수료에 VAT 포함/)).toBeDisabled();
  await expect(page.locator(".locked-tag").first()).toHaveText("활성 경매 중 잠금");
  await ctx.close();
});

test("② 일반 탭 — 대표 이메일 변경 저장 → DB · 감사 로그", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@gangu.kr", "gangu");
  await page.goto("/t/gangu/admin/settings?tab=general");
  const email = page.locator("input[type=email]");
  await email.fill("ops2@gangu.suhyup.kr");
  await page.getByRole("button", { name: "저장" }).click();
  await expectToast(page, "저장했습니다");
  const [t] = await sql`select contact_email from tenants where id = ${tid}`;
  expect(t.contact_email).toBe("ops2@gangu.suhyup.kr");
  const [log] = await sql`select action, actor_role, after from audit_logs where tenant_id = ${tid} and action like 'tenant.settings%' and at >= ${startedAt} order by at desc limit 1`;
  expect(log.action).toBe("tenant.settings.general");
  expect(log.actor_role).toBe("admin");
  expect(log.after.contactEmail).toBe("ops2@gangu.suhyup.kr");
  await page.reload();
  await expect(page.locator("input[type=email]")).toHaveValue("ops2@gangu.suhyup.kr");
  await ctx.close();
});

test("③ 경매 정책 탭 — 입찰 수정 허용 토글 잠금", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@gangu.kr", "gangu");
  await page.goto("/t/gangu/admin/settings?tab=auction");
  await expect(page.getByLabel(/입찰 수정 허용/)).toBeDisabled();
  await expect(page.getByLabel(/현장 경매\(호가식\) 병행/)).toBeEnabled(); // 잠금 대상 아님
  await expect(page.locator("select").filter({ has: page.locator("option[value='first_come']") })).toBeDisabled();
  await ctx.close();
});

let inviteHref = "";

test("④ 멤버 초청(노조) → 초청 링크 · DB", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@gangu.kr", "gangu");
  await page.goto("/t/gangu/admin/members");
  await page.getByRole("button", { name: "+ 멤버 초청" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("멤버 초청");
  await dialog.getByPlaceholder("김운영").fill("테스트초청");
  await dialog.locator("select").selectOption("union");
  await dialog.locator("input[type=email]").fill(INVITE_EMAIL);
  await dialog.getByRole("button", { name: "초청 메일 발송" }).click();
  await expectToast(page, "초청 메일을 발송했습니다");
  const linkDialog = page.getByRole("dialog");
  await expect(linkDialog).toContainText("초청 링크");
  const a = linkDialog.locator("a[href*='/invite/']");
  inviteHref = (await a.getAttribute("href"))!;
  expect(inviteHref).toMatch(/\/invite\/[0-9a-f]{32}$/);
  await linkDialog.getByRole("button", { name: "닫기" }).click();
  await expect(page.locator("table.data-table tbody tr").filter({ hasText: INVITE_EMAIL })).toContainText("노조");

  const [inv] = await sql`select role, name, token, accepted_at, expires_at from invitations where email = ${INVITE_EMAIL} and tenant_id = ${tid}`;
  expect(inv).toMatchObject({ role: "union", name: "테스트초청", accepted_at: null });
  expect(inviteHref.endsWith(`/invite/${inv.token}`)).toBeTruthy();
  expect(new Date(inv.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  await ctx.close();
});

test("⑤ 초청 수락(OTP 000000) → /login?joined=1 → 실제 로그인 → 노조 홈", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const path = inviteHref.startsWith("http") ? new URL(inviteHref).pathname : inviteHref;
  await page.goto(path);
  await expect(page.getByText(/강구항 수협.*노조.*초청되었습니다/)).toBeVisible();
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(page.getByText(/개발용: 000000/)).toBeVisible();
  await page.locator("input[name=password]").fill(PASSWORD);
  await page.locator("input[name=passwordConfirm]").fill(PASSWORD);
  await page.locator("input[name=otp]").fill("000000");
  await page.getByRole("button", { name: "가입 완료" }).click();
  await page.waitForURL(/\/login\?joined=1/);
  await expect(page.getByText("가입이 완료되었습니다")).toBeVisible();

  const [inv] = await sql`select accepted_at from invitations where email = ${INVITE_EMAIL}`;
  expect(inv.accepted_at).not.toBeNull();
  const [m] = await sql`select m.role, m.status, u.identity_verified from memberships m join users u on u.id = m.user_id where u.email = ${INVITE_EMAIL} and m.tenant_id = ${tid}`;
  expect(m).toMatchObject({ role: "union", status: "active", identity_verified: true });

  // 실제 로그인 폼
  await page.locator("#identifier").fill(INVITE_EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/t\/gangu\/union(\/|$)/);
  await expect(page.getByText(/운반 작업 예상/)).toBeVisible();
  await ctx.close();
});

test("⑥ 중매인 면허 — M-205 만료 임박 → 갱신(+1년)", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "admin@gangu.kr", "gangu");
  await page.goto("/t/gangu/admin/brokers");
  await expect(page.getByText(/만료 임박 \d+/)).toBeVisible();
  const row = page.locator("table.data-table tbody tr").filter({ hasText: "M-205" });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".days-left")).toHaveText("D-5");
  await expect(row.locator(".days-left")).toHaveClass(/danger/);

  const [before] = await sql`select license_expires_at::text as d from memberships where tenant_id = ${tid} and license_no = 'M-205'`;
  await row.getByRole("button", { name: "갱신" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("이상철 · 면허 갱신");
  const dateInput = dialog.locator("input[type=date]");
  const proposed = await dateInput.inputValue();
  expect(proposed.slice(0, 4)).toBe(String(Number(before.d.slice(0, 4)) + 1));
  await dialog.getByRole("button", { name: "저장" }).click();
  await expectToast(page, "면허 정보를 변경했습니다");

  const [after] = await sql`select license_expires_at::text as d, license_status from memberships where tenant_id = ${tid} and license_no = 'M-205'`;
  expect(after.license_status).toBe("active");
  expect(after.d).toBe(proposed);
  expect(after.d > before.d).toBeTruthy();
  expect(Number(after.d.slice(0, 4)) - Number(before.d.slice(0, 4))).toBe(1);
  const [log] = await sql`select action, after from audit_logs where tenant_id = ${tid} and action = 'license.update' and at >= ${startedAt} order by at desc limit 1`;
  expect(log.after.licenseExpiresAt).toBe(proposed);
  await expect(page.locator("table.data-table tbody tr").filter({ hasText: "M-205" }).locator(".days-left")).toHaveText("");
  await ctx.close();
});
