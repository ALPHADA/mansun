import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { updateTenantSettings, hasActiveAuctions, inviteMember, setMembershipStatus, updateLicense, registerShipper } from "@/services/tenant-admin";
import { acceptInvitation, issueOtp } from "@/services/auth";

const fx = new TenantFixture();
let vesselId: string, roundId: string;
const admin = () => fx.ctx("admin");
const auctionPatch = (over: Record<string, unknown> = {}) => ({
  digitalCloseBufferMin: 5, tieBreakPolicy: "first_come", digitalPriceVisibility: "hidden", bidModificationAllowed: true,
  fieldAuctionEnabled: false, bidMfaRequired: false, winnerDisclosure: "license_no", reservePrices: { flatfish: 15000 }, schedule: [], ...over,
});
interface MemRow { status: string; licenseStatus: string | null; licenseNo: string | null; licenseExpiresAt: string | null; suspendedAt: Date | null; joinedAt: Date | null; role: string }
const mem = (id: string) => fx.q<MemRow>`select * from memberships where id = ${id}`.then((r) => r[0]);
const feeNotifs = () => fx.q<{ userId: string }>`select * from notifications where tenant_id = ${fx.tenant.id} and type = 'fee_changed'`;

beforeAll(async () => {
  await fx.create();
  await fx.addUser("admin", "admin"); await fx.addUser("op", "operator"); await fx.addUser("ship", "shipper");
  await fx.addUser("b1", "broker", { licenseNo: "T-001" }); await fx.addUser("b2", "broker", { licenseNo: "T-002" }); await fx.addUser("b3", "broker", { licenseNo: "T-003" });
  vesselId = await fx.addVessel("관리호", "ship");
  roundId = (await fx.addRound({ seq: 1 })).id;
});
afterAll(() => fx.destroy());

describe("updateTenantSettings", () => {
  it("fees 유효값 → fee_policy 갱신 + 감사(before/after) + 중매인·운영자 fee_changed 알림(kakao)", async () => {
    expect(await hasActiveAuctions(fx.tenant.id)).toBe(false);
    const updated = await updateTenantSettings(admin(), "fees", { marketFeeRate: 0.05, brokerFeeRate: 0.02, vatIncluded: false, vatRate: 0.1 });
    expect(updated.feePolicy).toEqual({ marketFeeRate: 0.05, brokerFeeRate: 0.02, vatIncluded: false, vatRate: 0.1 });
    await fx.reload();
    expect(fx.tenant.feePolicy.marketFeeRate).toBe(0.05);
    const [log] = await fx.q<{ before: { marketFeeRate: number }; after: { marketFeeRate: number } }>`select * from audit_logs where tenant_id = ${fx.tenant.id} and action = 'tenant.settings.fees'`;
    expect(log.before.marketFeeRate).toBe(0.04); expect(log.after.marketFeeRate).toBe(0.05);
    const n = await feeNotifs();
    expect(new Set(n.map((x) => x.userId))).toEqual(new Set(["b1", "b2", "b3", "op"].map((k) => fx.users[k].userId)));
    expect(await fx.q`select * from notification_logs where tenant_id = ${fx.tenant.id} and channel = 'kakao' and subject like '%수수료%'`).toHaveLength(4);
    // 동일 값 재저장 → 알림 없음
    await updateTenantSettings(admin(), "fees", { marketFeeRate: 0.05, brokerFeeRate: 0.02, vatIncluded: false, vatRate: 0.1 });
    expect(await feeNotifs()).toHaveLength(4);
  });
  it("fees 범위/단위 검증 (zod)", async () => {
    await expect(updateTenantSettings(admin(), "fees", { marketFeeRate: 0.11, brokerFeeRate: 0.02, vatIncluded: true, vatRate: 0.1 })).rejects.toThrow(/위판수수료율은 0~10%/);
    await expect(updateTenantSettings(admin(), "fees", { marketFeeRate: 0.05, brokerFeeRate: 0.06, vatIncluded: true, vatRate: 0.1 })).rejects.toThrow(/중매인수수료율은 0~5%/);
    await expect(updateTenantSettings(admin(), "fees", { marketFeeRate: 0.0405, brokerFeeRate: 0.02, vatIncluded: true, vatRate: 0.1 })).rejects.toThrow(/0.1% 단위/);
    await expect(updateTenantSettings(admin(), "fees", { marketFeeRate: 0.05, brokerFeeRate: 0.02, vatIncluded: true, vatRate: 0.3 })).rejects.toThrow(/VAT율/);
    await expect(updateTenantSettings(admin(), "general", { name: "짧" })).rejects.toThrow(/2~40자/);
    await fx.reload();
    expect(fx.tenant.feePolicy.marketFeeRate).toBe(0.05);
  });
  it("잠금 규칙: 활성 경매 중 수수료/동점 정책 변경 거부, 일반 정보·버퍼는 허용", async () => {
    const lot = await fx.addLot(roundId, vesselId, { status: "open" });
    expect(await hasActiveAuctions(fx.tenant.id)).toBe(true);
    await expect(updateTenantSettings(admin(), "fees", { marketFeeRate: 0.04, brokerFeeRate: 0.02, vatIncluded: false, vatRate: 0.1 })).rejects.toThrow(/활성 경매 진행 중/);
    await expect(updateTenantSettings(admin(), "auction", auctionPatch({ tieBreakPolicy: "lottery" }))).rejects.toThrow(/활성 경매 진행 중/);
    const g = await updateTenantSettings(admin(), "general", { name: "변경된 수협", region: "경북", contactEmail: "", contactPhone: "054-123-4567" });
    expect(g).toMatchObject({ name: "변경된 수협", region: "경북", contactEmail: null, contactPhone: "054-123-4567" });
    await fx.reload();
    const a = await updateTenantSettings(admin(), "auction", auctionPatch({ digitalCloseBufferMin: 10 }));
    expect(a.digitalCloseBufferMin).toBe(10);
    await fx.reload();
    expect(fx.tenant.feePolicy.marketFeeRate).toBe(0.05);
    // 물품 종결 후에는 잠금 해제
    await fx.q`update auctions set status = 'withdrawn' where id = ${lot.id}`;
    const t = await updateTenantSettings(admin(), "auction", auctionPatch({ digitalCloseBufferMin: 10, tieBreakPolicy: "lottery" }));
    expect(t.tieBreakPolicy).toBe("lottery");
    await fx.update({ tie_break_policy: "first_come", fee_policy: { marketFeeRate: 0.04, brokerFeeRate: 0.015, vatIncluded: true, vatRate: 0.1 } });
  });
});

describe("inviteMember / acceptInvitation", () => {
  let token = "", invEmail = "";
  it("검증: 중매인 면허번호 필수, 면허 중복 conflict, 겸임 금지, 기존 역할 conflict, 이메일 형식", async () => {
    await expect(inviteMember(admin(), { name: "신규", email: `x@${fx.code}.test`, role: "broker" })).rejects.toThrow(/면허번호가 필요/);
    await expect(inviteMember(admin(), { name: "신규", email: `x@${fx.code}.test`, role: "broker", licenseNo: "T-001" })).rejects.toThrow(/이미 등록되어/);
    await expect(inviteMember(admin(), { name: "운영자", email: fx.users.op.email, role: "broker", licenseNo: "T-500" })).rejects.toThrow(/겸임할 수 없습니다/);
    await expect(inviteMember(admin(), { name: "중매인", email: fx.users.b1.email, role: "broker", licenseNo: "T-501" })).rejects.toThrow(/이미 .*가입된 사용자/);
    await expect(inviteMember(admin(), { name: "신규", email: "not-an-email", role: "union" })).rejects.toThrow(/이메일 형식/);
    expect(await fx.q`select * from invitations where tenant_id = ${fx.tenant.id}`).toHaveLength(0);
  });
  it("성공: invitations(토큰·7일 만료) + 이메일 로그(링크) + 감사; 중복 초청/면허 conflict; 비중매인은 면허 제거", async () => {
    invEmail = `NewBroker@${fx.code}.test`;
    const r = await inviteMember(admin(), { name: "신규중매", email: invEmail, phone: "010-5555-6666", role: "broker", licenseNo: "T-100", licenseExpiresAt: "2030-12-31" });
    const [inv] = await fx.q<{ token: string; email: string; phone: string; licenseNo: string; role: string; expiresAt: Date; invitedBy: string; acceptedAt: Date | null }>`select * from invitations where id = ${r.invitationId}`;
    token = inv.token;
    expect(inv.token).toMatch(/^[0-9a-f]{32}$/);
    expect(inv).toMatchObject({ email: invEmail.toLowerCase(), phone: "01055556666", licenseNo: "T-100", role: "broker", invitedBy: fx.users.admin.userId, acceptedAt: null });
    expect(Math.abs(inv.expiresAt.getTime() - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);
    expect(r.inviteLink).toBe(`http://localhost:3100/invite/${inv.token}`);
    const [mail] = await fx.q<{ recipient: string; payload: { link: string; type: string } }>`select * from notification_logs where tenant_id = ${fx.tenant.id} and channel = 'email'`;
    expect(mail.recipient).toBe(invEmail.toLowerCase()); expect(mail.payload.link).toBe(r.inviteLink); expect(mail.payload.type).toBe("invite");
    expect(await fx.q`select * from audit_logs where action = 'membership.invite' and target_id = ${r.invitationId}`).toHaveLength(1);

    await expect(inviteMember(admin(), { name: "신규중매", email: invEmail, role: "broker", licenseNo: "T-101" })).rejects.toThrow(/진행 중인 초청이 있습니다. 재발송/);
    await expect(inviteMember(admin(), { name: "다른사람", email: `other@${fx.code}.test`, role: "broker", licenseNo: "T-100" })).rejects.toThrow(/T-100 로 진행 중인 초청/);
    const u = await inviteMember(admin(), { name: "노조원", email: `union@${fx.code}.test`, role: "union", licenseNo: "T-999" });
    expect((await fx.q<{ licenseNo: string | null }>`select * from invitations where id = ${u.invitationId}`)[0].licenseNo).toBeNull();
  });
  it("acceptInvitation: 잘못된 토큰/OTP 거부 → OTP 000000 으로 수락 → membership active·면허 active·identity_verified", async () => {
    await expect(acceptInvitation("deadbeef", { password: "pw12345678", otp: "000000" })).rejects.toThrow(/유효하지 않거나 만료/);
    await expect(acceptInvitation(token, { password: "pw12345678", otp: "000000" })).rejects.toThrow(/인증번호/);      // 발급 전
    await issueOtp(invEmail.toLowerCase(), "invite");
    const [otp] = await fx.q<{ code: string; usedAt: Date | null }>`select * from otp_codes where target = ${invEmail.toLowerCase()} and purpose = 'invite'`;
    expect(otp.code).toBe("000000");
    await expect(acceptInvitation(token, { password: "pw12345678", otp: "111111" })).rejects.toThrow(/인증번호/);
    const res = await acceptInvitation(token, { password: "pw12345678", otp: "000000" });
    fx.trackUser(res.userId);
    expect(res.tenantCode).toBe(fx.code);
    const [u] = await fx.q<{ email: string; phone: string; identityVerified: boolean; name: string; passwordHash: string | null }>`select * from users where id = ${res.userId}`;
    expect(u).toMatchObject({ email: invEmail.toLowerCase(), phone: "01055556666", identityVerified: true, name: "신규중매" });
    expect(u.passwordHash).toBeTruthy();
    const [m] = await fx.q<MemRow>`select * from memberships where user_id = ${res.userId} and tenant_id = ${fx.tenant.id}`;
    expect(m).toMatchObject({ role: "broker", status: "active", licenseNo: "T-100", licenseStatus: "active" });
    expect(m.joinedAt).toBeInstanceOf(Date);
    expect((await fx.q<{ acceptedAt: Date | null }>`select * from invitations where token = ${token}`)[0].acceptedAt).toBeInstanceOf(Date);
    expect((await fx.q<{ usedAt: Date | null }>`select * from otp_codes where id = ${(await fx.q<{ id: string }>`select id from otp_codes where target = ${invEmail.toLowerCase()} and code = '000000'`)[0].id}`)[0].usedAt).toBeInstanceOf(Date);
    expect(await fx.q`select * from audit_logs where action = 'membership.accept_invite' and actor_user_id = ${res.userId}`).toHaveLength(1);
    // 수락된 초청은 재사용 불가
    await expect(acceptInvitation(token, { password: "pw12345678", otp: "000000" })).rejects.toThrow(/유효하지 않거나 만료/);
  });
});

describe("setMembershipStatus", () => {
  it("검증: 사유 필수, 본인 정지 불가, 동일 상태 stateError", async () => {
    await expect(setMembershipStatus(admin(), fx.users.b2.membershipId, "suspended")).rejects.toThrow(/정지 사유/);
    await expect(setMembershipStatus(admin(), fx.users.admin.membershipId, "suspended", "사유")).rejects.toThrow(/본인 계정/);
    await expect(setMembershipStatus(admin(), fx.users.b2.membershipId, "active")).rejects.toThrow(/이미 활성/);
    await expect(setMembershipStatus(admin(), "00000000-0000-0000-0000-000000000000", "active")).rejects.toThrow(/찾을 수 없습니다/);
  });
  it("중매인 정지 → licenseStatus suspended + 알림 + 감사; 복구 → active (만료일 지났으면 expired)", async () => {
    const id = fx.users.b2.membershipId;
    await setMembershipStatus(admin(), id, "suspended", "규정 위반");
    let m = await mem(id);
    expect(m).toMatchObject({ status: "suspended", licenseStatus: "suspended" }); expect(m.suspendedAt).toBeInstanceOf(Date);
    expect(await fx.q`select * from audit_logs where action = 'membership.suspend' and target_id = ${id} and reason = '규정 위반'`).toHaveLength(1);
    expect(await fx.q`select * from notifications where user_id = ${fx.users.b2.userId} and type = 'system' and title like '%정지되었습니다%'`).toHaveLength(1);
    await expect(setMembershipStatus(admin(), id, "suspended", "다시")).rejects.toThrow(/이미 정지/);
    await setMembershipStatus(admin(), id, "active");
    m = await mem(id);
    expect(m).toMatchObject({ status: "active", licenseStatus: "active", suspendedAt: null });
    // 만료일이 지난 중매인 복구 → expired
    await fx.q`update memberships set license_expires_at = '2020-01-01' where id = ${id}`;
    await setMembershipStatus(admin(), id, "suspended", "재정지");
    await setMembershipStatus(admin(), id, "active");
    expect((await mem(id)).licenseStatus).toBe("expired");
    await fx.q`update memberships set license_expires_at = null, license_status = 'active' where id = ${id}`;
  });
});

describe("updateLicense", () => {
  it("revoked 는 종료 상태, 정지/취소는 사유 필수, 비중매인 notFound, 변경 없음 validation", async () => {
    const id = fx.users.b3.membershipId;
    await expect(updateLicense(admin(), id, { licenseStatus: "suspended" })).rejects.toThrow(/사유/);
    await expect(updateLicense(admin(), id, {})).rejects.toThrow(/변경된 내용이 없습니다/);
    await expect(updateLicense(admin(), fx.users.ship.membershipId, { licenseStatus: "active" })).rejects.toThrow(/중매인을 찾을 수/);
    const after = await updateLicense(admin(), id, { licenseStatus: "revoked" }, "면허 취소 처분");
    expect(after.licenseStatus).toBe("revoked");
    await expect(updateLicense(admin(), id, { licenseStatus: "active" })).rejects.toThrow(/취소된 면허/);
    await expect(updateLicense(admin(), id, { licenseStatus: "suspended" }, "x")).rejects.toThrow(/취소된 면허/);
    expect(await fx.q`select * from audit_logs where action = 'license.update' and target_id = ${id}`).toHaveLength(1);
    expect(await fx.q`select * from notification_logs where channel = 'kakao' and user_id = ${fx.users.b3.userId} and subject like '%면허%'`).toHaveLength(1);
  });
  it("expired → active 는 미래 만료일 필요, 만료일 연장만으로 갱신, active 에 과거 만료일 거부, 면허번호 중복 conflict", async () => {
    const id = fx.users.b1.membershipId;
    await fx.q`update memberships set license_status = 'expired', license_expires_at = '2020-01-01' where id = ${id}`;
    await expect(updateLicense(admin(), id, { licenseStatus: "active" })).rejects.toThrow(/만료일이 지난 면허/);
    await expect(updateLicense(admin(), id, { licenseStatus: "active", licenseExpiresAt: "2019-12-31" })).rejects.toThrow(/만료일이 지난 면허/);
    let m = await updateLicense(admin(), id, { licenseStatus: "active", licenseExpiresAt: "2030-12-31" });
    expect(m).toMatchObject({ licenseStatus: "active", licenseExpiresAt: "2030-12-31" });
    await expect(updateLicense(admin(), id, { licenseExpiresAt: "2020-06-01" })).rejects.toThrow(/만료일은 오늘 이후/);
    await fx.q`update memberships set license_status = 'expired', license_expires_at = '2021-01-01' where id = ${id}`;
    m = await updateLicense(admin(), id, { licenseExpiresAt: "2031-01-01" });
    expect(m.licenseStatus).toBe("active");                       // 만료 면허 연장 = 갱신
    await expect(updateLicense(admin(), id, { licenseNo: "T-002" })).rejects.toThrow(/이미 등록되어/);
    m = await updateLicense(admin(), id, { licenseNo: "T-001A", licenseExpiresAt: "" });
    expect(m).toMatchObject({ licenseNo: "T-001A", licenseExpiresAt: null });
    expect((await mem(id)).licenseNo).toBe("T-001A");
  });
});

describe("registerShipper", () => {
  it("신규 사용자 + shipper membership, 임시 비밀번호(dev), SMS 로그, 감사; 중복 conflict; 전화 형식", async () => {
    const email = `newship@${fx.code}.test`;
    const r = await registerShipper(admin(), { name: "새선주", phone: "010-7777-8888", email, bankAccount: "농협 123-456" });
    fx.trackUser(r.userId);
    expect(r.tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    const [u] = await fx.q<{ email: string; phone: string; identityVerified: boolean; bankAccount: string }>`select * from users where id = ${r.userId}`;
    expect(u).toMatchObject({ email, phone: "01077778888", identityVerified: false, bankAccount: "농협 123-456" });
    expect(await mem(r.membershipId)).toMatchObject({ role: "shipper", status: "active" });
    expect(await fx.q`select * from notification_logs where channel = 'sms' and user_id = ${r.userId}`).toHaveLength(1);
    const [log] = await fx.q<{ after: { newUser: boolean; bankAccount: string } }>`select * from audit_logs where action = 'shipper.register' and target_id = ${r.membershipId}`;
    expect(log.after).toMatchObject({ newUser: true, bankAccount: "***" });
    await expect(registerShipper(admin(), { name: "새선주", phone: "01077778888" })).rejects.toThrow(/이미 선주로/);
    await expect(registerShipper(admin(), { name: "형식오류", phone: "12" })).rejects.toThrow(/전화번호 형식/);
  });
  it("기존 사용자(전화 일치) 재사용 → 새 membership 만 추가, 임시 비밀번호 없음 (역할 겸임 검사 없음)", async () => {
    const [{ phone }] = await fx.q<{ phone: string }>`select phone from users where id = ${fx.users.b1.userId}`;
    const r = await registerShipper(admin(), { name: "다른이름", phone });
    expect(r.userId).toBe(fx.users.b1.userId); expect(r.tempPassword).toBeNull();
    expect(await mem(r.membershipId)).toMatchObject({ role: "shipper", status: "active" });
    expect(await fx.q`select * from memberships where user_id = ${fx.users.b1.userId} and tenant_id = ${fx.tenant.id}`).toHaveLength(2);
  });
});
