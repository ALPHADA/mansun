import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { bypass, closeDb, deleteRoundData, expectToast, login, PASSWORD, pollDb, sql } from "./helpers";

/**
 * Platform Console: Tenant 생성(pending) → 초기 Admin 초청 수락 → 활성화/정지/해제 → 글로벌 사용자 정지/해제 → 분쟁 조회 모드(읽기 전용)
 * 생성한 e2etest 수협·계정은 afterAll 에서 SQL 로 정리한다 (재실행 안정성; `pnpm e2e` 의 db:reset 과 무관).
 */
test.describe.configure({ mode: "serial" });

const CODE = "e2etest";
const ADMIN_EMAIL = "e2e-admin@example.com";
let inviteHref = "";
let adminCtx: BrowserContext | null = null;
let adminPage: Page | null = null;

async function cleanup() {
  const [t] = await sql`select id from tenants where code = ${CODE}`;
  const [u] = await sql`select id from users where email = ${ADMIN_EMAIL}`;
  if (t) {
    const rounds = await sql`select id from rounds where tenant_id = ${t.id}`;
    for (const r of rounds) await deleteRoundData(r.id);
    await sql`delete from rounds where tenant_id = ${t.id}`;
    await sql`delete from vessels where tenant_id = ${t.id}`;
    await sql`delete from platform_read_sessions where tenant_id = ${t.id}`;
    await sql`delete from notifications where tenant_id = ${t.id}`;
    await sql`delete from notification_logs where tenant_id = ${t.id}`;
    await sql`delete from audit_logs where tenant_id = ${t.id}`;
    await sql`delete from memberships where tenant_id = ${t.id}`;
    await sql`delete from invitations where tenant_id = ${t.id}`;
  }
  if (u) {
    await sql`delete from notifications where user_id = ${u.id}`;
    await sql`delete from memberships where user_id = ${u.id}`;
    await sql`delete from users where id = ${u.id}`;
  }
  await sql`delete from otp_codes where target = ${ADMIN_EMAIL}`;
  if (t) await sql`delete from tenants where id = ${t.id}`;
}

test.beforeAll(async () => { await bypass(); await cleanup(); });
test.afterAll(async () => {
  await adminCtx?.close();
  await cleanup();
  await closeDb();
});

test("① Tenant 생성(pending) + 초기 Admin 초청", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "platform@mansun.kr");
  await page.goto("/platform/tenants/new");
  await page.locator("#f-code").fill(CODE);
  await page.locator("#f-name").fill("E2E 수협");
  await page.locator("#f-region").selectOption("경상북도");
  await page.locator("#f-businessNo").fill("1234567890");
  await page.locator("#f-address").fill("경북 테스트시 e2e로 1");
  await page.locator("#f-contactEmail").fill("ops@e2etest.suhyup.kr");
  await page.locator("#f-contactPhone").fill("054-000-0001");
  await page.locator("#f-adminName").fill("E2E관리");
  await page.locator("#f-adminEmail").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "생성 + 초청 메일 발송" }).click();
  const box = page.locator(".success-box");
  await expect(box).toContainText(`E2E 수협 (${CODE})`);
  await expect(box).toContainText("준비중(pending)");
  inviteHref = (await box.locator("a[href*='/invite/']").getAttribute("href"))!;
  expect(inviteHref).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);

  const [t] = await sql`select status, name, business_no, contact_email from tenants where code = ${CODE}`;
  expect(t).toMatchObject({ status: "pending", name: "E2E 수협", business_no: "1234567890", contact_email: "ops@e2etest.suhyup.kr" });
  const [inv] = await sql`select i.role, i.name, i.email, i.accepted_at from invitations i join tenants t on t.id = i.tenant_id where t.code = ${CODE}`;
  expect(inv).toMatchObject({ role: "admin", name: "E2E관리", email: ADMIN_EMAIL, accepted_at: null });
  await ctx.close();
});

test("② Admin 미가입 상태에서 활성화 시도 → 거부", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "platform@mansun.kr");
  await page.goto(`/platform/tenants/${CODE}`);
  await expect(page.getByText("활성화 대기 — 초기 Admin 미가입")).toBeVisible();
  await page.getByRole("button", { name: "✅ 활성화" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".danger-box")).toContainText("활성 상태의 수협 Admin 이 없습니다");
  await dialog.getByRole("button", { name: "활성화", exact: true }).click();
  await expectToast(page, /활성 상태의 수협 Admin이 1명 이상/);
  const [t] = await sql`select status from tenants where code = ${CODE}`;
  expect(t.status).toBe("pending");
  await dialog.getByRole("button", { name: "취소" }).click();
  await ctx.close();
});

test("③ 초청 수락 → e2e-admin 로그인 → pending 배너", async ({ browser }) => {
  adminCtx = await browser.newContext();
  adminPage = await adminCtx.newPage();
  await adminPage.goto(inviteHref.startsWith("http") ? new URL(inviteHref).pathname : inviteHref);
  await expect(adminPage.getByText(/E2E 수협.*수협 관리자.*초청되었습니다/)).toBeVisible();
  await adminPage.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(adminPage.getByText(/개발용: 000000/)).toBeVisible();
  await adminPage.locator("input[name=password]").fill(PASSWORD);
  await adminPage.locator("input[name=passwordConfirm]").fill(PASSWORD);
  await adminPage.locator("input[name=otp]").fill("000000");
  await adminPage.getByRole("button", { name: "가입 완료" }).click();
  await adminPage.waitForURL(/\/login\?joined=1/);
  await adminPage.locator("#identifier").fill(ADMIN_EMAIL);
  await adminPage.locator("#password").fill(PASSWORD);
  await adminPage.getByRole("button", { name: "로그인" }).click();
  await adminPage.waitForURL(/\/t\/e2etest\/admin(\/|$)/);
  await expect(adminPage.locator(".status-banner")).toContainText("활성화 전");
  const [m] = await sql`select m.role, m.status from memberships m join users u on u.id = m.user_id join tenants t on t.id = m.tenant_id where u.email = ${ADMIN_EMAIL} and t.code = ${CODE}`;
  expect(m).toMatchObject({ role: "admin", status: "active" });
});

test("④ 활성화 → 정지(사유) → 정지 배너 → 정지 해제", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "platform@mansun.kr");
  await page.goto(`/platform/tenants/${CODE}`);
  await expect(page.getByText("초기 Admin 가입 완료 — 활성화할 수 있습니다")).toBeVisible();
  await page.getByRole("button", { name: "✅ 활성화" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "활성화", exact: true }).click();
  await expectToast(page, "수협을 활성화했습니다");
  let t = await pollDb(async () => (await sql`select status, activated_at from tenants where code = ${CODE}`)[0], (x) => x.status === "active");
  expect(t.status).toBe("active");
  expect(t.activated_at).not.toBeNull();
  await adminPage!.reload();
  await expect(adminPage!.locator(".status-banner")).toHaveCount(0);

  // 정지
  await page.getByRole("button", { name: "⚠ 정지" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "정지", exact: true })).toBeDisabled();
  await dlg.locator("textarea").fill("e2e 정지 사유 테스트 — 열 자 이상 입력");
  await dlg.getByRole("button", { name: "정지", exact: true }).click();
  await expectToast(page, "수협을 정지했습니다");
  t = await pollDb(async () => (await sql`select status, suspend_reason from tenants where code = ${CODE}`)[0], (x) => x.status === "suspended");
  expect(t.status).toBe("suspended");
  expect(t.suspend_reason).toContain("e2e 정지 사유 테스트");
  await expect(page.locator(".alert-card")).toContainText("정지 상태");
  await adminPage!.reload();
  await expect(adminPage!.locator(".status-banner.warning")).toContainText("정지");
  const [{ n }] = await sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.email = ${ADMIN_EMAIL} and n.type = 'tenant_status' and n.title like '%정지되었습니다'`;
  expect(n).toBe(1);

  // 해제
  await page.getByRole("button", { name: "▶ 정지 해제" }).click();
  await page.getByRole("dialog").locator("textarea").fill("e2e 해제");
  await page.getByRole("dialog").getByRole("button", { name: "정지 해제", exact: true }).click();
  await expectToast(page, "수협을 정지를 해제했습니다");
  t = await pollDb(async () => (await sql`select status, suspend_reason from tenants where code = ${CODE}`)[0], (x) => x.status === "active");
  expect(t).toMatchObject({ status: "active", suspend_reason: null });
  await adminPage!.reload();
  await expect(adminPage!.locator(".status-banner")).toHaveCount(0);
  const actions = await sql`select action from audit_logs where tenant_id = (select id from tenants where code = ${CODE}) and action in ('tenant.activate','tenant.suspend','tenant.unsuspend') order by at`;
  expect(actions.map((a) => a.action)).toEqual(["tenant.activate", "tenant.suspend", "tenant.unsuspend"]);
  await ctx.close();
});

test("⑤ 글로벌 사용자 정지 → 로그인 차단 → 해제", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "platform@mansun.kr");
  await page.goto("/platform/users?q=E2E%EA%B4%80%EB%A6%AC");
  const row = page.locator("table.data-table tbody tr").filter({ hasText: ADMIN_EMAIL });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("E2E 수협");
  await row.getByRole("link", { name: "상세" }).click();
  await page.waitForURL(/\/platform\/users\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "⚠ 글로벌 정지" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.locator("textarea").fill("e2e 글로벌 정지 사유");
  await dlg.getByRole("button", { name: "정지", exact: true }).click();
  await expectToast(page, /글로벌 정지했습니다/);
  const [u] = await sql`select global_suspended from users where email = ${ADMIN_EMAIL}`;
  expect(u.global_suspended).toBe(true);
  const [m] = await sql`select m.status from memberships m join users uu on uu.id = m.user_id where uu.email = ${ADMIN_EMAIL}`;
  expect(m.status).toBe("suspended");

  // 로그인 차단
  const lctx = await browser.newContext();
  const lp = await lctx.newPage();
  await lp.goto("/login");
  await lp.locator("#identifier").fill(ADMIN_EMAIL);
  await lp.locator("#password").fill(PASSWORD);
  await lp.getByRole("button", { name: "로그인" }).click();
  await expect(lp.locator(".form-error")).toContainText("정지된 계정");
  await lctx.close();

  // 해제
  await page.getByRole("button", { name: "▶ 글로벌 정지 해제" }).click();
  dlg = page.getByRole("dialog");
  await dlg.locator("textarea").fill("e2e 해제 사유");
  await dlg.getByRole("button", { name: "해제", exact: true }).click();
  await expectToast(page, /글로벌 정지를 해제했습니다/);
  const [u2] = await sql`select global_suspended from users where email = ${ADMIN_EMAIL}`;
  expect(u2.global_suspended).toBe(false);
  const [m2] = await sql`select m.status from memberships m join users uu on uu.id = m.user_id where uu.email = ${ADMIN_EMAIL}`;
  expect(m2.status).toBe("active");
  await ctx.close();
});

test("⑥ 분쟁 조회 모드 → 읽기 전용 배너 · 개찰 버튼 없음", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await login(ctx, "platform@mansun.kr");
  await page.goto("/platform/tenants/gangu");
  await page.getByRole("button", { name: "🔍 분쟁 조회 모드로 진입" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "사유 기록 후 진입" })).toBeDisabled();
  await dlg.locator("textarea").fill("e2e 민원 #M-2026-0001 — 회차 결과 입찰 이력 확인 (20자 이상 사유)");
  await dlg.getByRole("button", { name: "사유 기록 후 진입" }).click();
  await page.waitForURL(/\/t\/gangu\/operator\/dashboard/);
  await expect(page.getByText("읽기 전용 (Platform Admin)")).toBeVisible();
  const [rs] = await sql`select reason, expires_at from platform_read_sessions where tenant_id = (select id from tenants where code = 'gangu') order by started_at desc limit 1`;
  expect(rs.reason).toContain("e2e 민원");
  expect(new Date(rs.expires_at).getTime()).toBeGreaterThan(Date.now() + 3 * 3600_000);

  await page.goto("/t/gangu/operator/results");
  await expect(page.getByText("읽기 전용 (Platform Admin)")).toBeVisible();
  await expect(page.getByRole("button", { name: "개찰", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /일괄 개찰/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "재개찰 신청" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /tick 실행/ })).toHaveCount(0);
  await ctx.close();
});
