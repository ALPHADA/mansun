import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { ensureTodayRounds, currentIntakeRound, upsertRound, listRounds, getRound } from "@/services/round";
import { kstDateTime, localDateStr, fmtShortDate } from "@/lib/format";

const fx = new TenantFixture();
const MON = "2031-03-10", SAT = "2031-03-08", OTHER = "2031-04-01";
const schedule = [
  { seq: 1, label: "오전 1회차", bidStart: "06:30", bidClose: "07:00", autoNoticeAt: "05:00" },
  { seq: 2, label: "오후 2회차", bidStart: "13:00", bidClose: "14:00", days: [1, 2, 3, 4, 5] },
];
const roundsOn = (date: string) => fx.q<{ id: string; seq: number; status: string; bidStartAt: Date; bidCloseAt: Date; fieldStartAt: Date | null; label: string }>`select * from rounds where tenant_id = ${fx.tenant.id} and date = ${date} order by seq`;

beforeAll(async () => {
  await fx.create({ schedule });
  await fx.addUser("admin", "admin");
  expect(new Date(`${MON}T00:00:00+09:00`).getDay()).toBe(1);
  expect(new Date(`${SAT}T00:00:00+09:00`).getDay()).toBe(6);
});
afterAll(() => fx.destroy());

describe("ensureTodayRounds", () => {
  it("schedule 기준 생성(scheduled, KST 시각, 라벨), 멱등", async () => {
    const list = await ensureTodayRounds(fx.tenant, MON);
    expect(list.map((r) => r.seq)).toEqual([1, 2]);
    expect(list[0]).toMatchObject({ status: "scheduled", date: MON, label: `${fmtShortDate(kstDateTime(MON, "07:00"))} 오전 1회차`, fieldStartAt: null });
    expect(list[0].bidStartAt.getTime()).toBe(kstDateTime(MON, "06:30").getTime());
    expect(list[0].bidCloseAt.getTime()).toBe(kstDateTime(MON, "07:00").getTime());
    expect(list[1].bidCloseAt.getTime()).toBe(kstDateTime(MON, "14:00").getTime());
    const again = await ensureTodayRounds(fx.tenant, MON);
    expect(again.map((r) => r.id)).toEqual(list.map((r) => r.id));
    expect(await roundsOn(MON)).toHaveLength(2);
  });
  it("days 지정 슬롯은 해당 요일에만 생성 (토요일 → 1회차만)", async () => {
    const list = await ensureTodayRounds(fx.tenant, SAT);
    expect(list.map((r) => r.seq)).toEqual([1]);
    expect(await roundsOn(SAT)).toHaveLength(1);
  });
  it("일부만 존재하면 누락 회차만 추가하고 seq 순 정렬", async () => {
    const tue = "2031-03-11";
    await fx.q`insert into rounds (tenant_id, date, seq, label, bid_start_at, bid_close_at, status) values (${fx.tenant.id}, ${tue}, 2, '수동 2회차', ${kstDateTime(tue, "12:00")}, ${kstDateTime(tue, "13:00")}, 'scheduled')`;
    const list = await ensureTodayRounds(fx.tenant, tue);
    expect(list.map((r) => [r.seq, r.label])).toEqual([[1, `${fmtShortDate(kstDateTime(tue, "07:00"))} 오전 1회차`], [2, "수동 2회차"]]);
    expect(list[1].bidCloseAt.getTime()).toBe(kstDateTime(tue, "13:00").getTime());   // 기존 행 유지
  });
  it("현장 경매 사용 시 fieldStartAt = 마감 + 버퍼(분)", async () => {
    await fx.update({ field_auction_enabled: true, digital_close_buffer_min: 7 });
    const list = await ensureTodayRounds(fx.tenant, OTHER);
    expect(list[0].fieldStartAt?.getTime()).toBe(kstDateTime(OTHER, "07:00").getTime() + 7 * 60_000);
    await fx.update({ field_auction_enabled: false, digital_close_buffer_min: 5 });
  });
});

describe("currentIntakeRound", () => {
  const today = localDateStr();
  const tomorrow = localDateStr(new Date(Date.now() + 86_400_000));
  it("오늘 회차 중 아직 마감되지 않은 가장 빠른 회차", async () => {
    await fx.update({ schedule: [{ seq: 1, label: "새벽", bidStart: "00:00", bidClose: "00:01" }, { seq: 2, label: "종일", bidStart: "00:02", bidClose: "23:59" }] });
    const r = await currentIntakeRound(fx.tenant);
    expect(r).toMatchObject({ date: today, seq: 2 });
    expect(await roundsOn(today)).toHaveLength(2);
  });
  it("오늘 회차가 모두 마감/취소되면 내일 첫 회차", async () => {
    await fx.q`update rounds set status = 'cancelled' where tenant_id = ${fx.tenant.id} and date = ${today} and seq = 2`;
    const r = await currentIntakeRound(fx.tenant);
    expect(r).toMatchObject({ date: tomorrow, seq: 1, status: "scheduled" });
    expect(await roundsOn(tomorrow)).toHaveLength(2);
  });
});

describe("upsertRound", () => {
  const D = "2031-05-05";
  it("검증: 마감 ≤ 시작, 현장 시작 < 마감+버퍼", async () => {
    const start = kstDateTime(D, "09:00"), close = kstDateTime(D, "10:00");
    await expect(upsertRound(fx.tenant, fx.users.admin.userId, { date: D, seq: 1, label: "x", bidStartAt: start, bidCloseAt: start })).rejects.toThrow(/마감은 시작 이후/);
    await expect(upsertRound(fx.tenant, fx.users.admin.userId, { date: D, seq: 1, label: "x", bidStartAt: close, bidCloseAt: start })).rejects.toThrow(/마감은 시작 이후/);
    await expect(upsertRound(fx.tenant, fx.users.admin.userId, { date: D, seq: 1, label: "x", bidStartAt: start, bidCloseAt: close, fieldStartAt: new Date(close.getTime() + 4 * 60_000) })).rejects.toThrow(/현장 경매 시작은 디지털 마감 \+ 5분/);
    expect(await roundsOn(D)).toHaveLength(0);
  });
  it("생성 → rounds + audit round.create; 수정 → 갱신 + audit round.update; 조회", async () => {
    const start = kstDateTime(D, "09:00"), close = kstDateTime(D, "10:00"), field = new Date(close.getTime() + 5 * 60_000);
    const r = await upsertRound(fx.tenant, fx.users.admin.userId, { date: D, seq: 1, label: "특별 회차", bidStartAt: start, bidCloseAt: close, fieldStartAt: field });
    expect(r).toMatchObject({ date: D, seq: 1, label: "특별 회차", status: "scheduled" });
    expect(r.fieldStartAt?.getTime()).toBe(field.getTime());
    expect(await fx.q`select * from audit_logs where action = 'round.create' and target_id = ${r.id}`).toHaveLength(1);
    const u = await upsertRound(fx.tenant, fx.users.admin.userId, { date: D, seq: 1, label: "특별 회차(변경)", bidStartAt: start, bidCloseAt: kstDateTime(D, "11:00") }, r.id);
    expect(u.id).toBe(r.id); expect(u.label).toBe("특별 회차(변경)"); expect(u.fieldStartAt).toBeNull();
    expect(u.bidCloseAt.getTime()).toBe(kstDateTime(D, "11:00").getTime());
    const [log] = await fx.q<{ before: { label: string }; after: { label: string } }>`select * from audit_logs where action = 'round.update' and target_id = ${r.id}`;
    expect(log.before.label).toBe("특별 회차"); expect(log.after.label).toBe("특별 회차(변경)");
    expect((await getRound(fx.tenant.id, r.id))?.label).toBe("특별 회차(변경)");
    const list = await listRounds(fx.tenant.id, { from: D, to: D });
    expect(list.map((x) => x.id)).toEqual([r.id]);
    expect(await getRound(fx.tenant.id, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
