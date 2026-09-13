import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { notify, usersByRoles, listNotifications, markRead, unreadCount } from "@/services/notification";

const fx = new TenantFixture();
let n = 0;
const title = () => `알림 테스트 ${fx.code} ${++n}`;
const inapp = (userId: string, t: string) => fx.q`select * from notifications where user_id = ${userId} and title = ${t}`;
const logs = (t: string, channel = "kakao") => fx.q<{ userId: string; recipient: string }>`select * from notification_logs where subject = ${t} and channel = ${channel}`;
// jsonb 파라미터는 객체 그대로 전달 (문자열로 넘기면 이중 인코딩)
const setPrefs = (membershipId: string, patch: Record<string, boolean>) => fx.q`update memberships set notification_prefs = notification_prefs || ${patch}::jsonb where id = ${membershipId}`;

beforeAll(async () => {
  await fx.create();
  await fx.addUser("b1", "broker", { licenseNo: "NT-1" }); await fx.addUser("b2", "broker", { licenseNo: "NT-2" });
  const bx = await fx.addUser("bx", "broker", { licenseNo: "NT-9" });
  await fx.q`update memberships set status = 'suspended' where id = ${bx.membershipId}`;
  const op = await fx.addUser("op", "operator");
  await fx.addMembership(op.userId, "receiver");
});
afterAll(() => fx.destroy());

describe("notify", () => {
  it("kakao 채널: 설정 kakao=false 사용자는 외부 발송 제외 (인앱은 유지), success = 인앱+채널 건수", async () => {
    await setPrefs(fx.users.b1.membershipId, { kakao: false });
    const t = title();
    const r = await notify({ tenantId: fx.tenant.id, userIds: [fx.users.b1.userId, fx.users.b2.userId], type: "notice", title: t, body: "본문", link: "/x", channels: ["kakao"] });
    expect(r).toEqual({ success: 3, fail: 0 });
    expect(await inapp(fx.users.b1.userId, t)).toHaveLength(1); expect(await inapp(fx.users.b2.userId, t)).toHaveLength(1);
    const l = await logs(t);
    expect(l).toHaveLength(1); expect(l[0].userId).toBe(fx.users.b2.userId);
  });
  it("mandatory 는 설정을 무시하고 발송", async () => {
    const t = title();
    const r = await notify({ tenantId: fx.tenant.id, userIds: [fx.users.b1.userId, fx.users.b2.userId], type: "awarded", title: t, channels: ["kakao"], mandatory: true });
    expect(r).toEqual({ success: 4, fail: 0 });
    expect(await logs(t)).toHaveLength(2);
  });
  it("type lost 는 lostBidInapp 설정을 따름, 그 외 타입은 inapp 설정을 따름", async () => {
    await setPrefs(fx.users.b1.membershipId, { lostBidInapp: false });
    const t = title();
    const r = await notify({ tenantId: fx.tenant.id, userIds: [fx.users.b1.userId, fx.users.b2.userId], type: "lost", title: t });
    expect(r).toEqual({ success: 1, fail: 0 });
    expect(await inapp(fx.users.b1.userId, t)).toHaveLength(0); expect(await inapp(fx.users.b2.userId, t)).toHaveLength(1);
    // lostBidInapp=false 여도 다른 타입은 수신
    const t2 = title();
    await notify({ tenantId: fx.tenant.id, userIds: [fx.users.b1.userId], type: "notice", title: t2 });
    expect(await inapp(fx.users.b1.userId, t2)).toHaveLength(1);
    await setPrefs(fx.users.b2.membershipId, { inapp: false });
    const t3 = title();
    expect(await notify({ tenantId: fx.tenant.id, userIds: [fx.users.b2.userId], type: "notice", title: t3 })).toEqual({ success: 0, fail: 0 });
    expect(await inapp(fx.users.b2.userId, t3)).toHaveLength(0);
    await setPrefs(fx.users.b2.membershipId, { inapp: true });
  });
  it("tenantId 없는(글로벌) 알림은 Membership 설정을 적용하지 않음; 중복 userId 제거; 빈 대상 → 0", async () => {
    const t = title();
    const r = await notify({ tenantId: null, userIds: [fx.users.b1.userId, fx.users.b1.userId], type: "otp", title: t, channels: ["kakao"] });
    expect(r).toEqual({ success: 2, fail: 0 });
    expect(await inapp(fx.users.b1.userId, t)).toHaveLength(1);
    expect(await logs(t)).toHaveLength(1);                     // kakao=false 설정이지만 글로벌 알림은 발송
    expect(await notify({ tenantId: fx.tenant.id, userIds: [], type: "notice", title: title() })).toEqual({ success: 0, fail: 0 });
  });
  it("수신처 없음(전화 없음) → fail 집계; inapp 채널은 외부 발송에서 무시; email 채널은 이메일로", async () => {
    const [{ phone }] = await fx.q<{ phone: string }>`select phone from users where id = ${fx.users.b2.userId}`;
    await fx.q`update users set phone = null where id = ${fx.users.b2.userId}`;
    const t = title();
    const r = await notify({ tenantId: fx.tenant.id, userIds: [fx.users.b2.userId], type: "notice", title: t, channels: ["inapp", "kakao", "email"] });
    expect(r).toEqual({ success: 2, fail: 1 });                // 인앱 1 + email 1, kakao 실패 1
    expect(await logs(t)).toHaveLength(0);
    const mail = await logs(t, "email");
    expect(mail).toHaveLength(1); expect(mail[0].recipient).toBe(fx.users.b2.email);
    await fx.q`update users set phone = ${phone} where id = ${fx.users.b2.userId}`;
  });
});

describe("usersByRoles / 알림함", () => {
  it("역할별 활성 사용자, 정지 제외, 다중 역할 1회, 빈 역할 → []", async () => {
    expect(new Set(await usersByRoles(fx.tenant.id, ["broker"]))).toEqual(new Set([fx.users.b1.userId, fx.users.b2.userId]));
    expect(await usersByRoles(fx.tenant.id, ["operator", "receiver"])).toEqual([fx.users.op.userId]);
    expect(await usersByRoles(fx.tenant.id, [])).toEqual([]);
    expect(await usersByRoles(fx.tenant.id, ["union"])).toEqual([]);
  });
  it("listNotifications / unreadCount / markRead", async () => {
    const uid = fx.users.op.userId;
    const t = title();
    await notify({ tenantId: fx.tenant.id, userIds: [uid], type: "system", title: t });
    const list = await listNotifications(uid, { tenantId: fx.tenant.id, unreadOnly: true });
    expect(list[0].n.title).toBe(t); expect(list[0].tenantCode).toBe(fx.code);
    expect(await unreadCount(uid)).toBe(1);
    await markRead(uid, [list[0].n.id]);
    expect(await unreadCount(uid)).toBe(0);
    await notify({ tenantId: fx.tenant.id, userIds: [uid], type: "system", title: title() });
    await markRead(uid, "all");
    expect(await listNotifications(uid, { unreadOnly: true })).toHaveLength(0);
  });
});
