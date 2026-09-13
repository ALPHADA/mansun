import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { sendNotice, recipientCounts, listNotices, type NoticeInput } from "@/services/notice";

const fx = new TenantFixture();
let vesselId: string, futureRound: string, startedRound: string;

const base = (roundId: string, patch: Partial<NoticeInput> = {}): NoticeInput =>
  ({ roundId, title: "오전 1회차 경매 공지", message: "오늘 오전 경매 공지입니다. 마감 전 입찰하세요.", targets: ["broker", "union", "staff"], channels: ["inapp", "kakao"], ...patch });
const send = (input: NoticeInput) => sendNotice(fx.tenant, fx.users.admin.userId, "admin", input);
const lotStatuses = (roundId: string) => fx.q<{ status: string }>`select status from auctions where round_id = ${roundId} order by auction_no`.then((r) => r.map((x) => x.status));
const roundStatus = (roundId: string) => fx.q<{ status: string }>`select status from rounds where id = ${roundId}`.then((r) => r[0].status);
const inapp = (userId: string, title: string) => fx.q`select * from notifications where user_id = ${userId} and type = 'notice' and title = ${title}`;

beforeAll(async () => {
  await fx.create();
  await fx.addUser("admin", "admin"); await fx.addUser("op", "operator"); await fx.addUser("rcv", "receiver");
  await fx.addUser("b1", "broker", { licenseNo: "N-001" }); await fx.addUser("b2", "broker", { licenseNo: "N-002" });
  const bx = await fx.addUser("bx", "broker", { licenseNo: "N-009" });
  await fx.q`update memberships set status = 'suspended' where id = ${bx.membershipId}`;
  await fx.addUser("u1", "union"); await fx.addUser("ship", "shipper");
  vesselId = await fx.addVessel("공지호", "ship");
  futureRound = (await fx.addRound({ seq: 1, startsInMin: 30, closesInMin: 60, status: "scheduled" })).id;
  startedRound = (await fx.addRound({ seq: 2, startsInMin: -5, closesInMin: 60, status: "scheduled" })).id;
  for (const rid of [futureRound, startedRound]) {
    await fx.addLot(rid, vesselId, { status: "registered" });
    await fx.addLot(rid, vesselId, { status: "registered", species: "flatfish" });
    await fx.q`update intakes set status = 'confirmed' where round_id = ${rid}`;     // 픽스처는 물품마다 입고 1건
  }
});
afterAll(() => fx.destroy());

describe("sendNotice 검증", () => {
  it("제목 2~40자, 메시지 10~500자, 대상/채널 1개 이상", async () => {
    await expect(send(base(futureRound, { title: "공" }))).rejects.toThrow(/제목은 2~40자/);
    await expect(send(base(futureRound, { title: "가".repeat(41) }))).rejects.toThrow(/제목은 2~40자/);
    await expect(send(base(futureRound, { message: "너무 짧다" }))).rejects.toThrow(/메시지는 10~500자/);
    await expect(send(base(futureRound, { message: "가".repeat(501) }))).rejects.toThrow(/메시지는 10~500자/);
    await expect(send(base(futureRound, { targets: [] }))).rejects.toThrow(/발송 대상/);
    await expect(send(base(futureRound, { channels: [] }))).rejects.toThrow(/채널/);
    expect(await fx.q`select * from notices where tenant_id = ${fx.tenant.id}`).toHaveLength(0);
  });
  it("없는 회차 → validation, 종료(done/cancelled) 회차 → stateError, 시각 변경 검증", async () => {
    await expect(send(base("00000000-0000-0000-0000-000000000000"))).rejects.toThrow(/회차를 선택/);
    const done = await fx.addRound({ seq: 8, status: "done" });
    await expect(send(base(done.id))).rejects.toThrow(/종료된 회차/);
    const now = Date.now();
    await expect(send(base(futureRound, { bidStartAt: new Date(now + 60_000), bidCloseAt: new Date(now + 60_000) }))).rejects.toThrow(/마감은 시작 이후/);
    await expect(send(base(futureRound, { bidStartAt: new Date(now + 60_000), bidCloseAt: new Date(now + 120_000), fieldStartAt: new Date(now + 120_000 + 4 * 60_000) }))).rejects.toThrow(/현장 경매 시작은 마감 \+ 5분/);
  });
});

describe("sendNotice 성공", () => {
  it("시작 전 회차: 수신자 = 활성 중매인+노조+직원, 물품 announced, 회차 announced, 입고 announced, 인앱/kakao 로그", async () => {
    const n = await send(base(futureRound));
    // b1, b2 (bx 정지 제외) + u1 + admin, op, rcv = 6
    expect(n.recipientCount).toBe(6); expect(n.lotCount).toBe(2); expect(n.mode).toBe("manual");
    expect(n.successCount).toBe(12); expect(n.failCount).toBe(0);           // 인앱 6 + kakao 6
    expect(n.roundLabel).toBe("테스트 1회차");
    const [row] = await fx.q<{ recipientCount: number; successCount: number; targets: string[]; channels: string[]; sentBy: string }>`select * from notices where id = ${n.id}`;
    expect(row).toMatchObject({ recipientCount: 6, successCount: 12, targets: ["broker", "union", "staff"], channels: ["inapp", "kakao"], sentBy: fx.users.admin.userId });
    expect(await lotStatuses(futureRound)).toEqual(["announced", "announced"]);
    expect(await roundStatus(futureRound)).toBe("announced");
    expect(await fx.q`select * from intakes where round_id = ${futureRound} and status = 'announced'`).toHaveLength(2);
    expect(await fx.q`select * from intakes where round_id = ${futureRound} and status = 'confirmed'`).toHaveLength(0);
    for (const k of ["b1", "u1", "op", "rcv", "admin"]) expect(await inapp(fx.users[k].userId, n.title), k).toHaveLength(1);
    expect(await inapp(fx.users.ship.userId, n.title)).toHaveLength(0);
    expect(await inapp(fx.users.bx.userId, n.title)).toHaveLength(0);
    const kakao = await fx.q<{ userId: string }>`select * from notification_logs where tenant_id = ${fx.tenant.id} and channel = 'kakao' and subject = ${n.title}`;
    expect(kakao).toHaveLength(6);
    expect(new Set(kakao.map((k) => k.userId))).toEqual(new Set(["b1", "b2", "u1", "admin", "op", "rcv"].map((k) => fx.users[k].userId)));
    expect(await fx.q`select * from audit_logs where action = 'notice.send' and target_id = ${n.id}`).toHaveLength(1);
    expect((await listNotices(fx.tenant.id))[0].notice.id).toBe(n.id);
  });
  it("이미 시작된 회차: 물품 open, 회차 in_progress; 재발송 시 상태 유지", async () => {
    const n = await send(base(startedRound, { targets: ["broker"], channels: ["inapp"], title: "2회차 공지" }));
    expect(n.recipientCount).toBe(2); expect(n.successCount).toBe(2);
    expect(await lotStatuses(startedRound)).toEqual(["open", "open"]);
    expect(await roundStatus(startedRound)).toBe("in_progress");
    expect(await fx.q`select * from notification_logs where tenant_id = ${fx.tenant.id} and subject = '2회차 공지'`).toHaveLength(0);
    const again = await send(base(startedRound, { targets: ["shipper"], channels: ["inapp"], title: "선주 대상 재공지" }));
    expect(again.recipientCount).toBe(1);
    expect(await inapp(fx.users.ship.userId, "선주 대상 재공지")).toHaveLength(1);
    expect(await lotStatuses(startedRound)).toEqual(["open", "open"]);
    expect(await roundStatus(startedRound)).toBe("in_progress");
  });
  it("시각 변경 포함 발송 → 회차 시각 갱신, 시작 시각이 미래면 물품 announced", async () => {
    const r = await fx.addRound({ seq: 3, startsInMin: -5, closesInMin: 60, status: "scheduled" });
    await fx.addLot(r.id, vesselId, { status: "registered" });
    const start = new Date(Date.now() + 20 * 60_000), close = new Date(Date.now() + 50 * 60_000), field = new Date(close.getTime() + 5 * 60_000);
    await send(base(r.id, { bidStartAt: start, bidCloseAt: close, fieldStartAt: field, title: "시각 변경 공지" }));
    const [row] = await fx.q<{ bidStartAt: Date; bidCloseAt: Date; fieldStartAt: Date; status: string }>`select * from rounds where id = ${r.id}`;
    expect(row.bidStartAt.getTime()).toBe(start.getTime()); expect(row.bidCloseAt.getTime()).toBe(close.getTime()); expect(row.fieldStartAt.getTime()).toBe(field.getTime());
    expect(row.status).toBe("announced");
    expect(await lotStatuses(r.id)).toEqual(["announced"]);
  });
});

describe("recipientCounts", () => {
  it("역할별 활성 인원 (정지 중매인 제외)", async () => {
    expect(await recipientCounts(fx.tenant.id)).toEqual({ broker: 2, union: 1, staff: 3, shipper: 1 });
  });
});
