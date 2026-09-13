import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { openAuction, requestReauction, raiseObjection, decideDispute, listDisputes } from "@/services/auction";

const fx = new TenantFixture();
let roundId: string, vesselId: string, vessel2Id: string;

interface DisputeRow { id: string; kind: string; status: string; raisedBy: string; raisedRole: string; reason: string; decidedBy: string | null; decisionNote: string | null; decidedAt: Date | null }
const disputesOf = (auctionId: string) => fx.q<DisputeRow>`select * from disputes where auction_id = ${auctionId} order by created_at`;
const results = (auctionId: string) => fx.q<{ attempt: number; isCurrent: boolean; outcome: string }>`select * from auction_results where auction_id = ${auctionId} order by attempt`;
const notifs = (userId: string, auctionNo: string) => fx.q<{ title: string }>`select * from notifications where user_id = ${userId} and type = 'dispute' and title like ${"%" + auctionNo + "%"}`;
const roundStatus = (id: string) => fx.q<{ status: string }>`select status from rounds where id = ${id}`.then((r) => r[0].status);

/** closed_digital 물품 + 입찰 + 개찰 → awarded */
async function awardedLot(rid = roundId, vid = vesselId) {
  const lot = await fx.addLot(rid, vid, { status: "closed_digital" });
  await fx.addBid(lot.id, "b1", 9000); await fx.addBid(lot.id, "b2", 8000);
  await openAuction(fx.ctx("op"), lot.id);
  return lot;
}

beforeAll(async () => {
  await fx.create();
  await fx.addUser("op", "operator"); await fx.addUser("admin", "admin");
  await fx.addUser("ship", "shipper"); await fx.addUser("ship2", "shipper");
  await fx.addUser("b1", "broker", { licenseNo: "D-001" }); await fx.addUser("b2", "broker", { licenseNo: "D-002" });
  vesselId = await fx.addVessel("분쟁호", "ship"); vessel2Id = await fx.addVessel("타인호", "ship2");
  roundId = (await fx.addRound({ seq: 1 })).id;
});
afterAll(() => fx.destroy());

describe("requestReauction", () => {
  it("awarded → disputed + disputes(open, reauction) + Admin 알림 + 감사", async () => {
    const lot = await awardedLot();
    const d = await requestReauction(fx.ctx("op"), lot.id, "가격 입력 오류로 재개찰 요청");
    expect(d.kind).toBe("reauction"); expect(d.status).toBe("open");
    expect((await fx.auction(lot.id)).status).toBe("disputed");
    const rows = await disputesOf(lot.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ raisedBy: fx.users.op.userId, raisedRole: "operator", reason: "가격 입력 오류로 재개찰 요청" });
    expect(await notifs(fx.users.admin.userId, lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.b1.userId, lot.auctionNo)).toHaveLength(0);
    expect(await fx.q`select * from audit_logs where action = 'auction.reauction_request' and target_id = ${lot.id}`).toHaveLength(1);
  });
  it("사유 5자 미만 / 낙찰·유찰 아닌 상태 → 거부", async () => {
    const lot = await awardedLot();
    await expect(requestReauction(fx.ctx("op"), lot.id, "짧음")).rejects.toThrow(/5자 이상/);
    const open = await fx.addLot(roundId, vesselId, { status: "open" });
    await expect(requestReauction(fx.ctx("op"), open.id, "이유가 충분히 김")).rejects.toThrow(/낙찰\/유찰 상태에서만/);
  });
});

describe("decideDispute — 재개찰", () => {
  it("승인 → closed_digital 복귀, 결과 is_current=false, 입찰 closed → 재개찰 시 attempt 2", async () => {
    const lot = await awardedLot();
    const d = await requestReauction(fx.ctx("op"), lot.id, "동일가 처리 오류 재개찰");
    const decided = await decideDispute(fx.ctx("admin"), d.id, true, "승인합니다");
    expect(decided.id).toBe(d.id);
    const [row] = await disputesOf(lot.id);
    expect(row).toMatchObject({ status: "approved", decidedBy: fx.users.admin.userId, decisionNote: "승인합니다" });
    expect(row.decidedAt).toBeInstanceOf(Date);
    const a = await fx.auction(lot.id);
    expect(a).toMatchObject({ status: "closed_digital", finalPrice: null, winnerMembershipId: null, awardSource: null, awardedAt: null });
    expect((await results(lot.id)).every((r) => !r.isCurrent)).toBe(true);
    expect((await fx.bids(lot.id)).every((b) => b.status === "closed" && b.isRebid === false)).toBe(true);
    // 신청자 + 입찰자 알림
    expect(await notifs(fx.users.op.userId, lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.b1.userId, lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.b2.userId, lot.auctionNo)).toHaveLength(1);

    await openAuction(fx.ctx("op"), lot.id);
    expect((await fx.auction(lot.id))).toMatchObject({ status: "awarded", finalPrice: 9000, winnerMembershipId: fx.users.b1.membershipId });
    expect((await results(lot.id)).map((r) => [r.attempt, r.isCurrent])).toEqual([[1, false], [2, true]]);
    // 승인된 재개찰이 있으면 2회째 신청 거부
    await expect(requestReauction(fx.ctx("op"), lot.id, "두 번째 재개찰 신청")).rejects.toThrow(/1회만/);
  });
  it("거부 → awarded 복귀, 결과 유지, 거부는 1회 제한에 포함되지 않음", async () => {
    const lot = await awardedLot();
    const d = await requestReauction(fx.ctx("op"), lot.id, "재개찰 신청 사유");
    await decideDispute(fx.ctx("admin"), d.id, false, "근거 부족");
    expect((await disputesOf(lot.id))[0].status).toBe("rejected");
    const a = await fx.auction(lot.id);
    expect(a).toMatchObject({ status: "awarded", finalPrice: 9000, winnerMembershipId: fx.users.b1.membershipId });
    expect((await results(lot.id))[0].isCurrent).toBe(true);
    expect((await fx.bids(lot.id)).find((b) => b.brokerMembershipId === fx.users.b1.membershipId)?.status).toBe("awarded");
    const d2 = await requestReauction(fx.ctx("op"), lot.id, "다시 재개찰 신청");
    expect(d2.status).toBe("open");
  });
  it("유찰 물품의 재개찰 거부 → passed 복귀", async () => {
    const lot = await fx.addLot(roundId, vesselId, { status: "closed_digital" });
    await openAuction(fx.ctx("op"), lot.id);
    const d = await requestReauction(fx.ctx("op"), lot.id, "유찰 재개찰 신청");
    await decideDispute(fx.ctx("admin"), d.id, false);
    expect((await fx.auction(lot.id)).status).toBe("passed");
  });
  it("이미 처리된 건 → stateError, 없는 건 → notFound", async () => {
    const lot = await awardedLot();
    const d = await requestReauction(fx.ctx("op"), lot.id, "재개찰 신청 사유");
    await decideDispute(fx.ctx("admin"), d.id, false);
    await expect(decideDispute(fx.ctx("admin"), d.id, true)).rejects.toThrow(/이미 처리된/);
    await expect(decideDispute(fx.ctx("admin"), "00000000-0000-0000-0000-000000000000", true)).rejects.toThrow(/찾을 수 없습니다/);
  });
  it("회차 done 상태에서 재개찰 승인 → 회차 auctioning 으로 복귀", async () => {
    const r = await fx.addRound({ seq: 2 });
    const lot = await awardedLot(r.id);
    expect(await roundStatus(r.id)).toBe("done");
    const d = await requestReauction(fx.ctx("op"), lot.id, "회차 종료 후 재개찰");
    await decideDispute(fx.ctx("admin"), d.id, true);
    expect(await roundStatus(r.id)).toBe("auctioning");
    await openAuction(fx.ctx("op"), lot.id);
    expect(await roundStatus(r.id)).toBe("done");
  });
  it("정산 확정(settled) 물품은 재개찰 승인 불가", async () => {
    const lot = await awardedLot();
    const d = await requestReauction(fx.ctx("op"), lot.id, "정산 후 재개찰 시도");
    await fx.q`update auctions set status = 'settled' where id = ${lot.id}`;
    await expect(decideDispute(fx.ctx("admin"), d.id, true)).rejects.toThrow(/정산 확정된/);
    expect((await disputesOf(lot.id))[0].status).toBe("open");   // 트랜잭션 롤백
  });
});

describe("raiseObjection — 선주 이의 제기", () => {
  it("본인 물품 → disputes(objection) + 운영자/Admin 알림", async () => {
    const lot = await awardedLot();
    const d = await raiseObjection(fx.ctx("ship"), lot.id, "중량 표기가 실제와 다릅니다");
    expect(d).toMatchObject({ kind: "objection", raisedRole: "shipper", raisedBy: fx.users.ship.userId, status: "open" });
    expect((await fx.auction(lot.id)).status).toBe("awarded");     // 상태 유지
    expect(await notifs(fx.users.op.userId, lot.auctionNo)).toHaveLength(1);
    expect(await notifs(fx.users.admin.userId, lot.auctionNo)).toHaveLength(1);
    const list = await listDisputes(fx.tenant.id, { status: ["open"], raisedBy: fx.users.ship.userId });
    expect(list.some((x) => x.dispute.id === d.id && x.auctionNo === lot.auctionNo)).toBe(true);
    // 이의 승인은 상태를 바꾸지 않음 (운영자가 재개찰 신청)
    await decideDispute(fx.ctx("admin"), d.id, true, "확인 후 재개찰 예정");
    expect((await disputesOf(lot.id))[0].status).toBe("approved");
    expect((await fx.auction(lot.id)).status).toBe("awarded");
  });
  it("다른 선주 → forbidden, 사유 짧음 → validation, open 물품 → stateError", async () => {
    const lot = await awardedLot();
    await expect(raiseObjection(fx.ctx("ship2"), lot.id, "내 물품이 아닌데 이의")).rejects.toThrow(/본인 물품/);
    await expect(raiseObjection(fx.ctx("ship"), lot.id, "짧다")).rejects.toThrow(/5자 이상/);
    const open = await fx.addLot(roundId, vessel2Id, { status: "open" });
    await expect(raiseObjection(fx.ctx("ship2"), open.id, "아직 개찰 전인데 이의")).rejects.toThrow(/낙찰\/유찰 이후/);
    expect(await disputesOf(lot.id)).toHaveLength(0);
  });
  it("낙찰 후 24시간 경과 → stateError", async () => {
    const lot = await awardedLot();
    await fx.q`update auctions set awarded_at = now() - interval '25 hours' where id = ${lot.id}`;
    await expect(raiseObjection(fx.ctx("ship"), lot.id, "하루 지난 뒤 이의 제기")).rejects.toThrow(/24시간/);
    await fx.q`update auctions set awarded_at = now() - interval '23 hours' where id = ${lot.id}`;
    await expect(raiseObjection(fx.ctx("ship"), lot.id, "23시간 뒤 이의 제기")).resolves.toMatchObject({ kind: "objection" });
  });
});
