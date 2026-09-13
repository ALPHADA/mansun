import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { __cookieJar } from "../mocks/next-headers";
import { login, selectTenant } from "@/services/auth";
import { verifySession, getSession, type SessionPayload } from "@/lib/auth/session";

const fx = new TenantFixture();        // 테넌트 A
const fxB = new TenantFixture();       // 테넌트 B (다중 소속 시나리오)
const PW = "test1234";

async function session(): Promise<SessionPayload> {
  const token = __cookieJar.get("mansun_session");
  expect(token, "세션 쿠키가 설정되어야 함").toBeTruthy();
  const s = await verifySession(token!);
  expect(s).not.toBeNull();
  return s!;
}

beforeAll(async () => {
  await fx.create(); await fxB.create();
  await fx.addUser("single", "operator");
  const multi = await fx.addUser("multi", "operator");
  await fxB.addMembership(multi.userId, "receiver");
  const dual = await fx.addUser("dual", "receiver");
  await fx.addMembership(dual.userId, "operator");
  const invited = await fx.addUser("invited", "broker", { licenseNo: "AU-1" });
  await fx.q`update memberships set status = 'invited' where id = ${invited.membershipId}`;
  await fx.addBareUser("none"); await fx.addBareUser("susp", { globalSuspended: true });
  await fx.addPlatformAdmin("pa");
});
afterAll(async () => { await fxB.destroy(); await fx.destroy(); });
beforeEach(() => __cookieJar.clear());

describe("login", () => {
  it("비밀번호 오류 → unauthorized + audit auth.login_failed(identifier), 쿠키 없음", async () => {
    await expect(login(fx.users.single.email, "wrong")).rejects.toMatchObject({ code: "unauthorized", message: expect.stringMatching(/올바르지 않습니다/) });
    await expect(login(`nobody@${fx.code}.test`, PW)).rejects.toMatchObject({ code: "unauthorized" });
    const logs = await fx.q<{ after: { identifier: string } }>`select * from audit_logs where action = 'auth.login_failed' and after->>'identifier' = ${fx.users.single.email}`;
    expect(logs).toHaveLength(1);
    expect(__cookieJar.has("mansun_session")).toBe(false);
  });
  it("단일 소속 → 쿠키(activeTenant 설정) + next /t/{code}, last_login_at, audit auth.login", async () => {
    const r = await login(fx.users.single.email, PW);
    expect(r.next).toBe(`/t/${fx.code}`);
    const s = await session();
    expect(s).toMatchObject({ userId: fx.users.single.userId, activeTenantId: fx.tenant.id, activeTenantCode: fx.code, activeRole: "operator", tenantRoles: ["operator"], isPlatformAdmin: false });
    expect(s.exp! - s.iat!).toBe(12 * 3600);
    expect((await getSession())?.userId).toBe(fx.users.single.userId);
    expect((await fx.q<{ lastLoginAt: Date | null }>`select * from users where id = ${fx.users.single.userId}`)[0].lastLoginAt).toBeInstanceOf(Date);
    expect(await fx.q`select * from audit_logs where action = 'auth.login' and actor_user_id = ${fx.users.single.userId}`).toHaveLength(1);
  });
  it("전화번호(하이픈 포함)로도 로그인 가능", async () => {
    const [{ phone }] = await fx.q<{ phone: string }>`select phone from users where id = ${fx.users.single.userId}`;
    const r = await login(`${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`, PW);
    expect(r.next).toBe(`/t/${fx.code}`);
  });
  it("같은 수협 다중 역할 → tenantRoles 우선순위 정렬, activeRole 은 최상위", async () => {
    await login(fx.users.dual.email, PW);
    const s = await session();
    expect(s.tenantRoles).toEqual(["operator", "receiver"]); expect(s.activeRole).toBe("operator");
  });
  it("2개 수협 소속 → next /select-tenant, activeTenant 없음", async () => {
    const r = await login(fx.users.multi.email, PW);
    expect(r.next).toBe("/select-tenant");
    expect(await session()).toMatchObject({ activeTenantId: null, activeTenantCode: null, activeRole: null, tenantRoles: [] });
  });
  it("소속 없음(또는 invited 만) → forbidden, 글로벌 정지 → forbidden", async () => {
    await expect(login(fx.bare.none.email, PW)).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/소속된 수협이 없습니다/) });
    await expect(login(fx.users.invited.email, PW)).rejects.toMatchObject({ code: "forbidden" });
    await expect(login(fx.bare.susp.email, PW)).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/정지된 계정/) });
    expect(__cookieJar.has("mansun_session")).toBe(false);
    expect(await fx.q`select * from audit_logs where action = 'auth.login' and actor_user_id = ${fx.bare.susp.userId}`).toHaveLength(0);
  });
  it("Platform Admin(소속 없음) → /select-tenant, isPlatformAdmin", async () => {
    const r = await login(fx.bare.pa.email, PW);
    expect(r.next).toBe("/select-tenant");
    expect(await session()).toMatchObject({ isPlatformAdmin: true, activeTenantId: null });
  });
});

describe("selectTenant", () => {
  it("소속 수협 선택 → 쿠키 갱신(activeTenantId/role) + next + audit; 비소속 → forbidden; platform → forbidden", async () => {
    await login(fx.users.multi.email, PW);
    const s = await session();
    const r = await selectTenant(s, fxB.code);
    expect(r.next).toBe(`/t/${fxB.code}`);
    expect(await session()).toMatchObject({ userId: fx.users.multi.userId, activeTenantId: fxB.tenant.id, activeTenantCode: fxB.code, activeRole: "receiver", tenantRoles: ["receiver"], readSessionId: null });
    expect(await fx.q`select * from audit_logs where action = 'auth.select_tenant' and actor_user_id = ${fx.users.multi.userId} and tenant_id = ${fxB.tenant.id}`).toHaveLength(1);
    const back = await selectTenant(await session(), fx.code);
    expect(back.next).toBe(`/t/${fx.code}`);
    expect((await session()).activeRole).toBe("operator");

    await login(fx.users.single.email, PW);
    const single = await session();
    await expect(selectTenant(single, fxB.code)).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/소속되지 않은/) });
    await expect(selectTenant(single, "platform")).rejects.toMatchObject({ code: "forbidden" });
    expect((await session()).activeTenantId).toBe(fx.tenant.id);   // 쿠키 변경 없음
  });
  it("Platform Admin: 비소속 수협 선택 → 분쟁 조회 모드 안내(쿠키 불변) + audit platform.enter_tenant, platform 복귀, 없는 수협 not_found", async () => {
    await login(fx.bare.pa.email, PW);
    const s = await session();
    const r = await selectTenant(s, fx.code);
    expect(r.next).toBe(`/platform/tenants/${fx.code}?readmode=required`);
    expect(await session()).toMatchObject({ activeTenantId: null, activeRole: null, tenantRoles: [], isPlatformAdmin: true });   // 세션은 그대로
    expect(await fx.q`select * from audit_logs where action = 'platform.enter_tenant' and actor_user_id = ${fx.bare.pa.userId} and tenant_id = ${fx.tenant.id}`).toHaveLength(1);
    const p = await selectTenant(await session(), "platform");
    expect(p.next).toBe("/platform");
    expect((await session()).activeTenantId).toBeNull();
    await expect(selectTenant(await session(), "nosuchtenant")).rejects.toMatchObject({ code: "not_found" });
  });
});
