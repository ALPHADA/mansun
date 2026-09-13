import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { TenantFixture, destroyTenantByCode } from "../helpers/fixture";
import { createTenant, changeTenantStatus, setUserGlobalSuspended, startReadSession, getTenantDetail, type PlatformActor, type TenantCreateInput } from "@/services/platform";

const fx = new TenantFixture();
let actor: PlatformActor;
const created: string[] = [];
const newCode = () => { const c = `p${randomUUID().replace(/-/g, "").replace(/\d/g, "").slice(0, 7)}`; created.push(c); return c; };
const input = (code: string, over: Partial<TenantCreateInput> = {}): TenantCreateInput => ({
  code, name: "신규 수협", region: "경북", businessNo: "123-45-67890", address: "포항시 위판장 1", contactEmail: "Contact@Example.test", contactPhone: "054-123-4567",
  adminName: "초기관리자", adminEmail: `admin@${code}.test`, adminPhone: "010-1111-2222", adminTitle: "과장", ...over,
});
interface TenantRow { id: string; status: string; activatedAt: Date | null; suspendedAt: Date | null; archivedAt: Date | null; suspendReason: string | null; feePolicy: { marketFeeRate: number }; schedule: { seq: number }[]; contactEmail: string; businessNo: string; contactPhone: string }
const tenantRow = (code: string) => fx.q<TenantRow>`select * from tenants where code = ${code}`.then((r) => r[0]);

beforeAll(async () => {
  await fx.create();
  await fx.addUser("adm", "admin"); await fx.addUser("victim", "broker", { licenseNo: "P-001" });
  const pa = await fx.addPlatformAdmin("pa");
  actor = { userId: pa.userId, name: pa.name };
});
afterAll(async () => { for (const c of created) await destroyTenantByCode(c); await fx.destroy(); });

describe("createTenant", () => {
  it("검증: code 규칙, 사업자번호 10자리, 이메일", async () => {
    await expect(createTenant(actor, input("Bad-Code"))).rejects.toThrow(/code는 영소문자/);
    await expect(createTenant(actor, input("1abc"))).rejects.toThrow(/code는 영소문자/);
    await expect(createTenant(actor, input("okcode", { businessNo: "123-45-678" }))).rejects.toThrow(/사업자등록번호는 숫자 10자리/);
    await expect(createTenant(actor, input("okcode", { adminEmail: "nope" }))).rejects.toThrow(/Admin 이메일/);
    expect(await fx.q`select * from tenants where code in ('okcode', '1abc')`).toHaveLength(0);
  });
  it("성공 → pending 테넌트(기본 수수료·일정) + Admin 초청 + 이메일 로그 + 감사; 중복 code conflict", async () => {
    const code = newCode();
    const r = await createTenant(actor, input(code));
    expect(r.tenant.status).toBe("pending");
    const t = await tenantRow(code);
    expect(t).toMatchObject({ status: "pending", businessNo: "1234567890", contactPhone: "0541234567", contactEmail: "contact@example.test", activatedAt: null });
    expect(t.feePolicy.marketFeeRate).toBe(0.04); expect(t.schedule[0].seq).toBe(1);
    const [inv] = await fx.q<{ token: string; role: string; email: string; phone: string; title: string; invitedBy: string; expiresAt: Date }>`select * from invitations where tenant_id = ${t.id}`;
    expect(inv).toMatchObject({ role: "admin", email: `admin@${code}.test`, phone: "01011112222", title: "과장", invitedBy: actor.userId });
    expect(r.inviteLink).toBe(`/invite/${inv.token}`);
    expect(Math.abs(inv.expiresAt.getTime() - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);
    expect(await fx.q`select * from notification_logs where tenant_id = ${t.id} and channel = 'email' and recipient = ${inv.email}`).toHaveLength(1);
    const actions = (await fx.q<{ action: string }>`select action from audit_logs where tenant_id = ${t.id} order by at`).map((a) => a.action);
    expect(actions).toEqual(["tenant.create", "membership.invite"]);
    const detail = await getTenantDetail(code);
    expect(detail?.pendingInvites).toHaveLength(1); expect(detail?.admins).toHaveLength(0);
    await expect(createTenant(actor, input(code))).rejects.toThrow(/이미 사용 중인 code/);
  });
});

describe("changeTenantStatus", () => {
  let code: string, tid: string;
  beforeAll(async () => { code = newCode(); tid = (await createTenant(actor, input(code))).tenant.id; });

  it("활성 Admin 없으면 활성화 불가 → Admin 가입 후 활성화 (activatedAt, 알림 email, 감사)", async () => {
    await expect(changeTenantStatus(actor, tid, "activate")).rejects.toThrow(/Admin이 1명 이상/);
    expect((await tenantRow(code)).status).toBe("pending");
    await fx.q`insert into memberships (user_id, tenant_id, role, status, joined_at) values (${fx.users.adm.userId}, ${tid}, 'admin', 'invited', null)`;
    await expect(changeTenantStatus(actor, tid, "activate")).rejects.toThrow(/Admin이 1명 이상/);   // invited 는 불충분
    await fx.q`update memberships set status = 'active', joined_at = now() where tenant_id = ${tid}`;
    const after = await changeTenantStatus(actor, tid, "activate");
    expect(after.status).toBe("active"); expect(after.activatedAt).toBeInstanceOf(Date); expect(after.suspendReason).toBeNull();
    expect(await fx.q`select * from notifications where tenant_id = ${tid} and user_id = ${fx.users.adm.userId} and type = 'tenant_status' and title like '%운영이 시작%'`).toHaveLength(1);
    expect(await fx.q`select * from notification_logs where tenant_id = ${tid} and channel = 'email' and user_id = ${fx.users.adm.userId}`).toHaveLength(1);
    const [log] = await fx.q<{ before: { status: string }; after: { status: string; notifyTarget: string } }>`select * from audit_logs where tenant_id = ${tid} and action = 'tenant.activate'`;
    expect(log.before.status).toBe("pending"); expect(log.after).toMatchObject({ status: "active", notifyTarget: "admin" });
  });
  it("정지: 사유 10자 이상 + 기간 필수 → suspended(suspendedAt, 사유에 기간 표기); 해제 → active", async () => {
    await expect(changeTenantStatus(actor, tid, "suspend", { reason: "짧은사유", duration: "7d" })).rejects.toThrow(/10자 이상/);
    await expect(changeTenantStatus(actor, tid, "suspend", { reason: "운영 규정 위반으로 정지합니다" })).rejects.toThrow(/정지 기간/);
    const s = await changeTenantStatus(actor, tid, "suspend", { reason: "운영 규정 위반으로 정지합니다", duration: "7d", notifyTarget: "none" });
    expect(s.status).toBe("suspended"); expect(s.suspendedAt).toBeInstanceOf(Date); expect(s.suspendReason).toBe("운영 규정 위반으로 정지합니다 (기간: 7일)");
    expect(await fx.q`select * from notifications where tenant_id = ${tid} and title like '%정지되었습니다%'`).toHaveLength(0);   // notifyTarget none
    await expect(changeTenantStatus(actor, tid, "activate")).rejects.toThrow(/활성화할 수 없습니다/);        // suspended → activate 불가
    const u = await changeTenantStatus(actor, tid, "unsuspend");
    expect(u).toMatchObject({ status: "active", suspendReason: null, suspendedAt: null });
    expect(u.activatedAt).toBeInstanceOf(Date);                 // 최초 활성화 시각 유지
  });
  it("아카이브(사유 필수) → archived; archived 에서는 activate/unsuspend/suspend 모두 불가", async () => {
    await expect(changeTenantStatus(actor, tid, "archive", { reason: "짧다" })).rejects.toThrow(/10자 이상/);
    const a = await changeTenantStatus(actor, tid, "archive", { reason: "폐업으로 아카이브 처리합니다", notifyTarget: "all" });
    expect(a.status).toBe("archived"); expect(a.archivedAt).toBeInstanceOf(Date); expect(a.suspendReason).toBe("폐업으로 아카이브 처리합니다");
    expect(await fx.q`select * from notifications where tenant_id = ${tid} and user_id = ${fx.users.adm.userId} and title like '%아카이브%'`).toHaveLength(1);
    await expect(changeTenantStatus(actor, tid, "activate")).rejects.toThrow(/현재 상태\(archived\)/);
    await expect(changeTenantStatus(actor, tid, "unsuspend")).rejects.toThrow(/현재 상태\(archived\)/);
    await expect(changeTenantStatus(actor, tid, "suspend", { reason: "운영 규정 위반으로 정지합니다", duration: "30d" })).rejects.toThrow(/현재 상태\(archived\)/);
  });
  it("pending → suspend/unsuspend/archive 불가, 없는 테넌트 notFound", async () => {
    const c2 = newCode();
    const t2 = (await createTenant(actor, input(c2))).tenant.id;
    await expect(changeTenantStatus(actor, t2, "suspend", { reason: "운영 규정 위반으로 정지합니다", duration: "7d" })).rejects.toThrow(/현재 상태\(pending\)에서는 정지/);
    await expect(changeTenantStatus(actor, t2, "unsuspend")).rejects.toThrow(/현재 상태\(pending\)/);
    await expect(changeTenantStatus(actor, t2, "archive", { reason: "폐업으로 아카이브 처리합니다" })).rejects.toThrow(/현재 상태\(pending\)/);
    await expect(changeTenantStatus(actor, "00000000-0000-0000-0000-000000000000", "activate")).rejects.toThrow(/찾을 수 없습니다/);
    expect((await tenantRow(c2)).status).toBe("pending");
  });
});
describe("setUserGlobalSuspended", () => {
  it("정지 → global_suspended + 모든 active membership suspended + 감사(플랫폼/테넌트); 해제 → 복원", async () => {
    const uid = fx.users.victim.userId, mid = fx.users.victim.membershipId;
    await expect(setUserGlobalSuspended(actor, uid, true, "짧음")).rejects.toThrow(/5자 이상/);
    await expect(setUserGlobalSuspended(actor, actor.userId, true, "플랫폼 관리자 정지 시도")).rejects.toThrow(/Platform Admin 계정/);
    await expect(setUserGlobalSuspended(actor, uid, false, "정지 아닌데 해제")).rejects.toThrow(/정지 상태가 아닙니다/);

    const r = await setUserGlobalSuspended(actor, uid, true, "다수 수협에서 규정 위반");
    expect(r).toEqual({ suspended: 1, restored: 0 });
    expect((await fx.q<{ globalSuspended: boolean }>`select * from users where id = ${uid}`)[0].globalSuspended).toBe(true);
    const [m] = await fx.q<{ status: string; suspendedAt: Date | null }>`select * from memberships where id = ${mid}`;
    expect(m.status).toBe("suspended"); expect(m.suspendedAt).toBeInstanceOf(Date);
    const [log] = await fx.q<{ tenantId: string | null; before: { activeMembershipIds: string[] }; reason: string }>`select * from audit_logs where action = 'user.global_suspend' and target_id = ${uid}`;
    expect(log.tenantId).toBeNull(); expect(log.before.activeMembershipIds).toEqual([mid]); expect(log.reason).toBe("다수 수협에서 규정 위반");
    const [tlog] = await fx.q<{ after: { cause: string } }>`select * from audit_logs where tenant_id = ${fx.tenant.id} and action = 'membership.suspend' and target_id = ${mid}`;
    expect(tlog.after.cause).toBe("global_suspend");
    await expect(setUserGlobalSuspended(actor, uid, true, "이미 정지된 사용자")).rejects.toThrow(/이미 정지된/);

    const u = await setUserGlobalSuspended(actor, uid, false, "소명 완료로 해제");
    expect(u).toEqual({ suspended: 0, restored: 1 });
    expect((await fx.q<{ globalSuspended: boolean }>`select * from users where id = ${uid}`)[0].globalSuspended).toBe(false);
    expect((await fx.q<{ status: string; suspendedAt: Date | null }>`select * from memberships where id = ${mid}`)[0]).toMatchObject({ status: "active", suspendedAt: null });
    expect(await fx.q`select * from audit_logs where action = 'membership.unsuspend' and target_id = ${mid}`).toHaveLength(1);
  });
  it("수협 Admin 이 개별 정지한 membership 은 글로벌 해제 시 복원되지 않음", async () => {
    const uid = fx.users.victim.userId, mid = fx.users.victim.membershipId;
    await fx.q`update memberships set status = 'suspended', suspended_at = now() where id = ${mid}`;
    expect(await setUserGlobalSuspended(actor, uid, true, "개별 정지 상태에서 글로벌 정지")).toEqual({ suspended: 0, restored: 0 });
    expect(await setUserGlobalSuspended(actor, uid, false, "글로벌 해제만 수행")).toEqual({ suspended: 0, restored: 0 });
    expect((await fx.q<{ status: string }>`select * from memberships where id = ${mid}`)[0].status).toBe("suspended");
    await fx.q`update memberships set status = 'active', suspended_at = null where id = ${mid}`;
  });
});

describe("startReadSession", () => {
  it("사유 20자 미만 거부, 없는 테넌트 notFound, 성공 → platform_read_sessions(4h) + 감사 + Admin 알림", async () => {
    await expect(startReadSession(actor, fx.tenant.id, "민원 확인")).rejects.toThrow(/20자 이상/);
    await expect(startReadSession(actor, "00000000-0000-0000-0000-000000000000", "민원 번호 2026-0913 낙찰 결과 이의 확인을 위한 조회")).rejects.toThrow(/찾을 수 없습니다/);
    const reason = "민원 번호 2026-0913 낙찰 결과 이의 확인을 위한 조회";
    const s = await startReadSession(actor, fx.tenant.id, reason);
    expect(s.tenantCode).toBe(fx.code);
    expect(Math.abs(s.expiresAt.getTime() - (Date.now() + 4 * 3600_000))).toBeLessThan(60_000);
    const [row] = await fx.q<{ adminUserId: string; tenantId: string; reason: string; expiresAt: Date }>`select * from platform_read_sessions where id = ${s.id}`;
    expect(row).toMatchObject({ adminUserId: actor.userId, tenantId: fx.tenant.id, reason });
    expect(await fx.q`select * from audit_logs where tenant_id = ${fx.tenant.id} and action = 'platform.read_session' and actor_user_id = ${actor.userId}`).toHaveLength(1);
    expect(await fx.q`select * from notifications where user_id = ${fx.users.adm.userId} and tenant_id = ${fx.tenant.id} and title like '%분쟁 조회 모드%'`).toHaveLength(1);
    expect(await fx.q`select * from notifications where user_id = ${fx.users.victim.userId} and title like '%분쟁 조회 모드%'`).toHaveLength(0);
  });
});
