import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { openAuction, openAllClosed, enterFieldResult, finishRoundIfDone } from "@/services/auction";
import { placeBid } from "@/services/bid";

const fx = new TenantFixture();
let roundId: string, vesselId: string;

interface ResultRow { attempt: number; isCurrent: boolean; outcome: string; reason: string | null; tieBreak: string | null; source: string; winnerMembershipId: string | null; winners: { membershipId: string; share: number }[] | null; finalPrice: number | null }
const results = (auctionId: string) => fx.q<ResultRow>`select * from auction_results where auction_id = ${auctionId} order by attempt`;
const notifs = (userId: string, type: string, auctionNo: string) =>
  fx.q<{ id: string; title: string; tenantId: string }>`select * from notifications where user_id = ${userId} and type = ${type} and title like ${"%" + auctionNo + "%"}`;
const closedLot = (opts: Parameters<TenantFixture["addLot"]>[2] = {}) => fx.addLot(roundId, vesselId, { status: "closed_digital", ...opts });

beforeAll(async () => {
  await fx.create();
  await fx.addUser("op", "operator"); await fx.addUser("admin", "admin"); await fx.addUser("ship", "shipper");
  await fx.addUser("b1", "broker", { licenseNo: "A-001" }); await fx.addUser("b2", "broker", { licenseNo: "A-002" }); await fx.addUser("b3", "broker", { licenseNo: "A-003" });
  vesselId = await fx.addVessel("개찰호", "ship");
  roundId = (await fx.addRound({ seq: 1 })).id;
});
afterAll(() => fx.destroy());

describe("openAuction — 디지털 개찰", () => {
  it("단독 최고가 → awarded/digital, 낙찰 bid awarded·나머지 lost, 결과 1건 is_current", async () => {
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000); await fx.addBid(lot.id, "b2", 8000);
    await openAuction(fx.ctx("op"), lot.id);
    const a = await fx.auction(lot.id);
    expect(a.status).toBe("awarded"); expect(a.awardSource).toBe("digital"); expect(a.finalPrice).toBe(9000);
    expect(a.winnerMembershipId).toBe(fx.users.b1.membershipId); expect(a.digitalHighPrice).toBe(9000); expect(a.awardedAt).toBeInstanceOf(Date);
    const bids = await fx.bids(lot.id);
    expect(bids.find((b) => b.brokerMembershipId === fx.users.b1.membershipId)?.status).toBe("awarded");
    expect(bids.find((b) => b.brokerMembershipId === fx.users.b2.membershipId)?.status).toBe("lost");
    const rs = await results(lot.id);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ attempt: 1, isCurrent: true, outcome: "awarded", source: "digital", winnerMembershipId: fx.users.b1.membershipId, tieBreak: null, finalPrice: 9000 });
    const audits = await fx.q`select * from audit_logs where tenant_id = ${fx.tenant.id} and action = 'auction.open' and target_id = ${lot.id}`;
    expect(audits).toHaveLength(1);
  });
  it("알림: 낙찰자 awarded, 패찰자 lost, 선주 awarded (+ 낙찰자 kakao 로그)", async () => {
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9100); await fx.addBid(lot.id, "b2", 8100);
    await openAuction(fx.ctx("op"), lot.id);
    expect(await notifs(fx.users.b1.userId, "awarded", lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.b2.userId, "lost", lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.b2.userId, "awarded", lot.auctionNo)).toHaveLength(0);
    expect(await notifs(fx.users.ship.userId, "awarded", lot.auctionNo)).toHaveLength(1);
    const kakao = await fx.q`select * from notification_logs where tenant_id = ${fx.tenant.id} and channel = 'kakao' and user_id = ${fx.users.b1.userId} and subject like ${"%" + lot.auctionNo + "%"}`;
    expect(kakao).toHaveLength(1);
  });
  it("동일가 first_come → 최초 제출이 빠른 입찰 낙찰", async () => {
    const lot = await closedLot();
    await fx.addBid(lot.id, "b2", 9000, 5); await fx.addBid(lot.id, "b1", 9000, 10);
    await openAuction(fx.ctx("op"), lot.id);
    const a = await fx.auction(lot.id);
    expect(a.winnerMembershipId).toBe(fx.users.b1.membershipId);
    expect((await results(lot.id))[0].tieBreak).toBe("first_come");
  });
  it("동일가 lottery → 동일가 입찰자 중 1명 낙찰", async () => {
    await fx.update({ tie_break_policy: "lottery" });
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000); await fx.addBid(lot.id, "b2", 9000); await fx.addBid(lot.id, "b3", 7000);
    await openAuction(fx.ctx("op"), lot.id);
    const a = await fx.auction(lot.id);
    expect([fx.users.b1.membershipId, fx.users.b2.membershipId]).toContain(a.winnerMembershipId);
    expect(a.winnerMembershipId).not.toBe(fx.users.b3.membershipId);
    expect((await results(lot.id))[0].tieBreak).toBe("lottery");
    expect((await fx.bids(lot.id)).filter((b) => b.status === "awarded")).toHaveLength(1);
    await fx.update({ tie_break_policy: "first_come" });
  });
  it("동일가 split → outcome split, winners 지분 0.5, 두 입찰 모두 awarded", async () => {
    await fx.update({ tie_break_policy: "split" });
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000); await fx.addBid(lot.id, "b2", 9000); await fx.addBid(lot.id, "b3", 8000);
    await openAuction(fx.ctx("op"), lot.id);
    const a = await fx.auction(lot.id);
    expect(a.status).toBe("awarded"); expect(a.finalPrice).toBe(9000);
    const [r] = await results(lot.id);
    expect(r.outcome).toBe("split"); expect(r.tieBreak).toBe("split");
    expect(r.winners?.map((w) => w.share)).toEqual([0.5, 0.5]);
    expect(new Set(r.winners?.map((w) => w.membershipId))).toEqual(new Set([fx.users.b1.membershipId, fx.users.b2.membershipId]));
    const bids = await fx.bids(lot.id);
    expect(bids.filter((b) => b.status === "awarded")).toHaveLength(2);
    expect(bids.find((b) => b.brokerMembershipId === fx.users.b3.membershipId)?.status).toBe("lost");
    await fx.update({ tie_break_policy: "first_come" });
  });
  it("입찰 없음 → passed(reason no_bids), 선주 passed 알림", async () => {
    const lot = await closedLot();
    await openAuction(fx.ctx("op"), lot.id);
    const a = await fx.auction(lot.id);
    expect(a.status).toBe("passed"); expect(a.awardSource).toBe("none"); expect(a.finalPrice).toBeNull(); expect(a.winnerMembershipId).toBeNull();
    const [r] = await results(lot.id);
    expect(r.outcome).toBe("passed"); expect(r.reason).toBe("no_bids");
    expect(await notifs(fx.users.ship.userId, "passed", lot.auctionNo)).toHaveLength(1);
  });
  it("최저가 미달 → passed(reason below_reserve), 입찰은 lost", async () => {
    const lot = await closedLot({ species: "flatfish", reservePrice: 15000 });
    await fx.addBid(lot.id, "b1", 14000); await fx.addBid(lot.id, "b2", 13000);
    await openAuction(fx.ctx("op"), lot.id);
    expect((await fx.auction(lot.id)).status).toBe("passed");
    expect((await results(lot.id))[0].reason).toBe("below_reserve");
    expect((await fx.bids(lot.id)).every((b) => b.status === "lost")).toBe(true);
  });
  it("awarded/open 상태에서는 개찰 불가, 없는 물품은 not_found", async () => {
    const lot = await closedLot();
    await openAuction(fx.ctx("op"), lot.id);
    await expect(openAuction(fx.ctx("op"), lot.id)).rejects.toThrow(/개찰할 수 없습니다/);
    const open = await fx.addLot(roundId, vesselId, { status: "open" });
    await expect(openAuction(fx.ctx("op"), open.id)).rejects.toThrow(/개찰할 수 없습니다/);
    await expect(openAuction(fx.ctx("op"), "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe("재입찰(rebid) 흐름", () => {
  it("동일가 rebid → status rebid, rebidUntil ≈ 5분, 동일가 입찰만 isRebid → 재입찰 후 개찰", async () => {
    await fx.update({ tie_break_policy: "rebid" });
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000); await fx.addBid(lot.id, "b2", 9000); await fx.addBid(lot.id, "b3", 8500);
    await openAuction(fx.ctx("op"), lot.id);
    const a = await fx.auction(lot.id);
    expect(a.status).toBe("rebid");
    const untilMs = (a.rebidUntil as Date).getTime() - Date.now();
    expect(untilMs).toBeGreaterThan(4.5 * 60_000); expect(untilMs).toBeLessThanOrEqual(5 * 60_000);
    const bids = await fx.bids(lot.id);
    const by = (k: string) => bids.find((b) => b.brokerMembershipId === fx.users[k].membershipId)!;
    expect(by("b1")).toMatchObject({ isRebid: true, status: "submitted" });
    expect(by("b2")).toMatchObject({ isRebid: true, status: "submitted" });
    expect(by("b3")).toMatchObject({ isRebid: false, status: "closed" });
    expect((await results(lot.id))[0]).toMatchObject({ outcome: "rebid", tieBreak: "rebid", isCurrent: true });
    // 재입찰 후보 알림
    expect(await notifs(fx.users.b1.userId, "notice", lot.auctionNo)).toHaveLength(1);

    // 비후보(b3: 낮은 가격) 및 미참여 중매인은 재입찰 불가
    await expect(placeBid(fx.ctx("b3"), lot.id, { price: 9500 })).rejects.toThrow(/재입찰 대상자가 아닙니다/);
    // 후보는 기존가 이상만 가능
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 8999 })).rejects.toThrow(/기존 입찰가 이상/);
    const r = await placeBid(fx.ctx("b1"), lot.id, { price: 9500 });
    expect(r.modified).toBe(true); expect(r.bid.revision).toBe(2);

    // 재입찰 개찰 (onlyRebid) → attempt 2, b1 낙찰
    await openAuction(fx.ctx("op"), lot.id);
    const after = await fx.auction(lot.id);
    expect(after.status).toBe("awarded"); expect(after.finalPrice).toBe(9500); expect(after.winnerMembershipId).toBe(fx.users.b1.membershipId); expect(after.rebidUntil).toBeNull();
    const rs = await results(lot.id);
    expect(rs.map((x) => [x.attempt, x.isCurrent, x.outcome])).toEqual([[1, false, "rebid"], [2, true, "awarded"]]);
    const bids2 = await fx.bids(lot.id);
    expect(bids2.find((b) => b.brokerMembershipId === fx.users.b2.membershipId)?.status).toBe("lost");
    expect(bids2.find((b) => b.brokerMembershipId === fx.users.b3.membershipId)?.status).toBe("lost");
    await fx.update({ tie_break_policy: "first_come" });
  });
});

describe("enterFieldResult — 현장 결과", () => {
  it("현장가 > 디지털가 → awarded/field, 현장 낙찰자, 디지털 입찰 lost", async () => {
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 8000);
    const detail = await enterFieldResult(fx.ctx("op"), lot.id, { price: 9000, winnerMembershipId: fx.users.b2.membershipId, note: "현장 호가" });
    const a = await fx.auction(lot.id);
    expect(a.status).toBe("awarded"); expect(a.awardSource).toBe("field"); expect(a.finalPrice).toBe(9000);
    expect(a.winnerMembershipId).toBe(fx.users.b2.membershipId); expect(a.fieldHighPrice).toBe(9000); expect(a.fieldNote).toBe("현장 호가");
    expect((await fx.bids(lot.id))[0].status).toBe("lost");
    expect(detail?.results[0]).toMatchObject({ outcome: "awarded", source: "field", fieldHighPrice: 9000, digitalHighPrice: 8000 });
    expect(await notifs(fx.users.b2.userId, "awarded", lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.b1.userId, "lost", lot.auctionNo)).toHaveLength(1);
    const audits = await fx.q`select * from audit_logs where tenant_id = ${fx.tenant.id} and action = 'auction.field_result' and target_id = ${lot.id}`;
    expect(audits).toHaveLength(1);
  });
  it("현장가 < 디지털가 → 디지털 낙찰", async () => {
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000);
    await enterFieldResult(fx.ctx("op"), lot.id, { price: 8500, winnerMembershipId: fx.users.b2.membershipId });
    const a = await fx.auction(lot.id);
    expect(a.awardSource).toBe("digital"); expect(a.winnerMembershipId).toBe(fx.users.b1.membershipId); expect(a.finalPrice).toBe(9000);
  });
  it("현장가 == 디지털가 → 디지털 우선", async () => {
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000);
    await enterFieldResult(fx.ctx("op"), lot.id, { price: 9000, winnerMembershipId: fx.users.b2.membershipId });
    const a = await fx.auction(lot.id);
    expect(a.awardSource).toBe("digital"); expect(a.winnerMembershipId).toBe(fx.users.b1.membershipId);
  });
  it("open 물품/0원/중매인 아님 → 거부", async () => {
    const open = await fx.addLot(roundId, vesselId, { status: "open" });
    await expect(enterFieldResult(fx.ctx("op"), open.id, { price: 9000, winnerMembershipId: fx.users.b1.membershipId })).rejects.toThrow(/디지털 마감 후/);
    const lot = await closedLot();
    await expect(enterFieldResult(fx.ctx("op"), lot.id, { price: 0, winnerMembershipId: fx.users.b1.membershipId })).rejects.toThrow(/0보다 커야/);
    await expect(enterFieldResult(fx.ctx("op"), lot.id, { price: 9000, winnerMembershipId: fx.users.ship.membershipId })).rejects.toThrow(/유효한 중매인/);
    expect((await fx.auction(lot.id)).status).toBe("closed_digital");
  });
  it("하이브리드 수협: 현장 결과 없이 개찰 불가, withoutField 옵션으로만 가능", async () => {
    await fx.update({ field_auction_enabled: true });
    const lot = await closedLot();
    await fx.addBid(lot.id, "b1", 9000);
    await expect(openAuction(fx.ctx("op"), lot.id)).rejects.toThrow(/현장 결과가 입력되지/);
    expect((await fx.auction(lot.id)).status).toBe("closed_digital");
    await openAuction(fx.ctx("op"), lot.id, { withoutField: true });
    expect((await fx.auction(lot.id)).status).toBe("awarded");
    const [audit] = await fx.q<{ after: { withoutField: boolean } }>`select * from audit_logs where action = 'auction.open' and target_id = ${lot.id}`;
    expect(audit.after.withoutField).toBe(true);
    await fx.update({ field_auction_enabled: false });
  });
});

describe("openAllClosed / finishRoundIfDone", () => {
  it("closed_digital·field_open 만 일괄 개찰, open 물품은 유지 → 회차 미종결", async () => {
    const r = await fx.addRound({ seq: 2 });
    const a = await fx.addLot(r.id, vesselId, { status: "closed_digital" });
    const b = await fx.addLot(r.id, vesselId, { status: "field_open" });
    const c = await fx.addLot(r.id, vesselId, { status: "open" });
    const d = await fx.addLot(r.id, vesselId, { status: "closed_digital" });
    await fx.addBid(a.id, "b1", 5000); await fx.addBid(b.id, "b2", 6000);
    await openAuction(fx.ctx("op"), d.id);
    expect(await openAllClosed(fx.ctx("op"), r.id)).toBe(2);
    expect((await fx.auction(a.id)).status).toBe("awarded");
    expect((await fx.auction(b.id)).status).toBe("awarded");
    expect((await fx.auction(c.id)).status).toBe("open");
    expect((await fx.q<{ status: string }>`select status from rounds where id = ${r.id}`)[0].status).toBe("in_progress");
  });
  it("모든 물품 종결 시 회차 done (disputed 도 종결로 간주, rebid 는 미종결)", async () => {
    const r = await fx.addRound({ seq: 3 });
    const a = await fx.addLot(r.id, vesselId, { status: "closed_digital" });
    const b = await fx.addLot(r.id, vesselId, { status: "closed_digital" });
    await fx.addBid(a.id, "b1", 5000);
    await openAuction(fx.ctx("op"), a.id);
    const st = () => fx.q<{ status: string }>`select status from rounds where id = ${r.id}`.then((x) => x[0].status);
    expect(await st()).toBe("in_progress");
    await openAuction(fx.ctx("op"), b.id);       // 입찰 없음 → passed
    expect(await st()).toBe("done");
    // rebid 물품이 남아 있으면 종결 아님
    await fx.q`update auctions set status = 'rebid' where id = ${a.id}`;
    await fx.q`update rounds set status = 'auctioning' where id = ${r.id}`;
    await finishRoundIfDone(fx.tenant.id, r.id);
    expect(await st()).toBe("auctioning");
    // disputed 는 회차 종결을 막지 않음 (재개찰 승인 시 decideDispute 가 done → auctioning 으로 되돌림)
    await fx.q`update auctions set status = 'disputed' where id = ${a.id}`;
    await finishRoundIfDone(fx.tenant.id, r.id);
    expect(await st()).toBe("done");
  });
  it("cancelled 회차는 done 으로 바뀌지 않음", async () => {
    const r = await fx.addRound({ seq: 4, status: "cancelled" });
    await finishRoundIfDone(fx.tenant.id, r.id);
    expect((await fx.q<{ status: string }>`select status from rounds where id = ${r.id}`)[0].status).toBe("cancelled");
  });
});
