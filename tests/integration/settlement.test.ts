import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { openAuction } from "@/services/auction";
import { generateSettlements, confirmRoundSettlements, markPaid, listSettlements, roundSettlementSummary } from "@/services/settlement";
import { calcParty } from "@/domain/settlement/calc";
import { localDateStr } from "@/lib/format";

const fx = new TenantFixture();
let roundId: string, v1: string, v2: string;
let L1: string, L2: string, L3: string, L4: string;
const yyyymm = localDateStr().slice(0, 7).replace("-", "");
const settlements = (rid: string) => listSettlements(fx.tenant.id, { roundId: rid });
const lines = (settlementId: string) => fx.q<{ auctionId: string; quantity: number; unitPrice: number; grossAmount: string; feeAmount: string }>`select * from settlement_lines where settlement_id = ${settlementId} order by unit_price`;
const status = (auctionId: string) => fx.auction(auctionId).then((a) => a.status);

async function award(rid: string, vid: string, weightKg: number, bids: [string, number][]) {
  const lot = await fx.addLot(rid, vid, { status: "closed_digital", weightKg });
  for (const [k, p] of bids) await fx.addBid(lot.id, k, p);
  await openAuction(fx.ctx("op"), lot.id);
  return lot.id;
}

beforeAll(async () => {
  await fx.create();
  await fx.addUser("op", "operator"); await fx.addUser("ship1", "shipper"); await fx.addUser("ship2", "shipper");
  await fx.addUser("b1", "broker", { licenseNo: "S-001" }); await fx.addUser("b2", "broker", { licenseNo: "S-002" });
  v1 = await fx.addVessel("일호", "ship1"); v2 = await fx.addVessel("이호", "ship2");
  roundId = (await fx.addRound({ seq: 1 })).id;
  L1 = await award(roundId, v1, 100, [["b1", 8000]]);                    // ship1 / b1  800,000
  L2 = await award(roundId, v1, 50, [["b2", 10000]]);                    // ship1 / b2  500,000
  L3 = await award(roundId, v2, 200, [["b1", 12000], ["b2", 11000]]);    // ship2 / b1  2,400,000
  L4 = await award(roundId, v2, 10, []);                                 // passed
});
afterAll(() => fx.destroy());

describe("generateSettlements", () => {
  it("선주별·중매인별 1건, 정산번호 {code}-S-YYYYMM-0001.., 금액 = calcParty, 라인 수", async () => {
    expect(await generateSettlements(fx.ctx("op"), roundId)).toBe(4);
    const rows = await settlements(roundId);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.s.settlementNo).sort()).toEqual([1, 2, 3, 4].map((n) => `${fx.code}-S-${yyyymm}-000${n}`));
    expect(rows.every((r) => r.s.status === "pending")).toBe(true);
    const by = (type: "shipper" | "broker", key: string) => rows.find((r) => r.s.partyType === type && r.s.partyUserId === fx.users[key].userId)!;

    const ship1 = by("shipper", "ship1");
    const exp1 = calcParty([{ auctionId: L1, unitPrice: 8000, quantity: 100, unit: "kg" }, { auctionId: L2, unitPrice: 10000, quantity: 50, unit: "kg" }], fx.tenant.feePolicy, "shipper");
    expect(ship1.s).toMatchObject({ lotCount: 2, grossAmount: 1_300_000, feeAmount: 52_000, vatAmount: 0, netAmount: 1_248_000, feeRate: 0.04, partyMembershipId: null });
    expect(ship1.s).toMatchObject({ grossAmount: exp1.grossAmount, feeAmount: exp1.feeAmount, netAmount: exp1.netAmount });
    expect(ship1.vesselNames).toBe("일호");
    expect(await lines(ship1.s.id)).toHaveLength(2);

    const ship2 = by("shipper", "ship2");
    expect(ship2.s).toMatchObject({ lotCount: 1, grossAmount: 2_400_000, feeAmount: 96_000, netAmount: 2_304_000 });

    const b1 = by("broker", "b1");
    const expB1 = calcParty([{ auctionId: L1, unitPrice: 8000, quantity: 100, unit: "kg" }, { auctionId: L3, unitPrice: 12000, quantity: 200, unit: "kg" }], fx.tenant.feePolicy, "broker");
    expect(b1.s).toMatchObject({ lotCount: 2, grossAmount: 3_200_000, feeAmount: 48_000, netAmount: 3_248_000, feeRate: 0.015, partyMembershipId: fx.users.b1.membershipId });
    expect(b1.s.netAmount).toBe(expB1.netAmount);
    expect(b1.licenseNo).toBe("S-001");
    const b1Lines = await lines(b1.s.id);
    expect(b1Lines.map((l) => [l.auctionId, l.quantity, l.unitPrice, Number(l.grossAmount), Number(l.feeAmount)])).toEqual([[L1, 100, 8000, 800_000, 12_000], [L3, 200, 12000, 2_400_000, 36_000]]);

    const b2 = by("broker", "b2");
    expect(b2.s).toMatchObject({ lotCount: 1, grossAmount: 500_000, feeAmount: 7_500, netAmount: 507_500 });
    // 유찰 물품은 어디에도 포함되지 않음
    expect(await fx.q`select * from settlement_lines where auction_id = ${L4}`).toHaveLength(0);
    expect(await fx.q`select * from audit_logs where action = 'settlement.generate' and target_id = ${roundId}`).toHaveLength(1);
  });
  it("재생성은 멱등 (pending 삭제 후 재생성, 건수·번호 동일, 중복 없음)", async () => {
    expect(await generateSettlements(fx.ctx("op"), roundId)).toBe(4);
    const rows = await settlements(roundId);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.s.settlementNo).sort()).toEqual([1, 2, 3, 4].map((n) => `${fx.code}-S-${yyyymm}-000${n}`));
    const [{ n }] = await fx.q<{ n: number }>`select count(*)::int as n from settlement_lines where tenant_id = ${fx.tenant.id}`;
    expect(n).toBe(6);
  });
  it("없는 회차 → notFound", async () => {
    await expect(generateSettlements(fx.ctx("op"), "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/회차를 찾을 수/);
  });
});

describe("confirmRoundSettlements / markPaid", () => {
  it("개찰 안 끝난 물품(open) 있으면 확정 불가", async () => {
    const open = await fx.addLot(roundId, v1, { status: "open" });
    await expect(confirmRoundSettlements(fx.ctx("op"), roundId)).rejects.toThrow(/개찰이 끝나지 않은/);
    expect((await settlements(roundId)).every((r) => r.s.status === "pending")).toBe(true);
    await fx.q`delete from auctions where id = ${open.id}`;
  });
  it("확정 → confirmed + erp_ref, ERP 로그, 물품 settled, 정산서 알림(email)", async () => {
    const r = await confirmRoundSettlements(fx.ctx("op"), roundId);
    expect(r).toEqual({ ok: 4, fail: 0 });
    const rows = await settlements(roundId);
    expect(rows.every((x) => x.s.status === "confirmed" && x.s.confirmedBy === fx.users.op.userId && x.s.confirmedAt instanceof Date)).toBe(true);
    expect(rows.every((x) => x.s.erpRef === `ERP-${x.s.settlementNo}`)).toBe(true);
    const erp = await fx.q<{ subject: string }>`select * from notification_logs where tenant_id = ${fx.tenant.id} and channel = 'erp'`;
    expect(erp.map((e) => e.subject).sort()).toEqual(rows.map((x) => x.s.settlementNo).sort());
    expect([await status(L1), await status(L2), await status(L3), await status(L4)]).toEqual(["settled", "settled", "settled", "passed"]);
    for (const k of ["ship1", "ship2", "b1", "b2"]) {
      const n = await fx.q<{ link: string }>`select * from notifications where user_id = ${fx.users[k].userId} and type = 'settlement_issued'`;
      expect(n, k).toHaveLength(1);
      expect(n[0].link).toBe(`/t/${fx.code}/${fx.users[k].role}/settlement`);
      expect(await fx.q`select * from notification_logs where channel = 'email' and user_id = ${fx.users[k].userId}`, k).toHaveLength(1);
    }
    expect(await fx.q`select * from audit_logs where action = 'settlement.confirm' and tenant_id = ${fx.tenant.id}`).toHaveLength(4);
  });
  it("두 번째 확정 → stateError(확정할 정산 없음); 확정 후 재생성은 confirmed 를 건너뜀", async () => {
    await expect(confirmRoundSettlements(fx.ctx("op"), roundId)).rejects.toThrow(/확정할 정산이 없습니다/);
    expect(await generateSettlements(fx.ctx("op"), roundId)).toBe(0);
    expect(await settlements(roundId)).toHaveLength(4);
  });
  it("markPaid: confirmed → paid, paid/pending → stateError", async () => {
    const [first] = await settlements(roundId);
    await markPaid(fx.ctx("op"), first.s.id);
    const [row] = await fx.q<{ status: string; paidAt: Date | null }>`select * from settlements where id = ${first.s.id}`;
    expect(row.status).toBe("paid"); expect(row.paidAt).toBeInstanceOf(Date);
    await expect(markPaid(fx.ctx("op"), first.s.id)).rejects.toThrow(/확정된 정산만/);
    await expect(markPaid(fx.ctx("op"), "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/찾을 수 없습니다/);
  });
  it("roundSettlementSummary 합계", async () => {
    const s = await roundSettlementSummary(fx.tenant, roundId);
    expect(s).toMatchObject({ gross: 3_700_000, marketFee: 148_000, brokerFee: 55_500, shipperPayable: 3_552_000, allConfirmed: true });
    expect(s.shippers).toHaveLength(2); expect(s.brokers).toHaveLength(2);
    expect((await listSettlements(fx.tenant.id, { roundId, partyType: "shipper" })).every((r) => r.s.partyType === "shipper")).toBe(true);
    expect(await listSettlements(fx.tenant.id, { roundId, partyUserId: fx.users.b2.userId })).toHaveLength(1);
  });
});

describe("split 낙찰 정산", () => {
  it("동일가 split → 중매인 정산은 지분(0.5) 비례, 선주는 전량; pending 상태 summary.allConfirmed=false", async () => {
    await fx.update({ tie_break_policy: "split" });
    const r2 = await fx.addRound({ seq: 2 });
    const lot = await award(r2.id, v1, 100, [["b1", 9000], ["b2", 9000]]);
    expect(await fx.q`select * from auction_results where auction_id = ${lot} and outcome = 'split' and is_current`).toHaveLength(1);
    expect(await generateSettlements(fx.ctx("op"), r2.id)).toBe(3);
    const rows = await settlements(r2.id);
    // 기존 4건 다음 번호부터
    expect(rows.map((x) => x.s.settlementNo).sort()).toEqual([5, 6, 7].map((n) => `${fx.code}-S-${yyyymm}-000${n}`));
    const ship = rows.find((x) => x.s.partyType === "shipper")!;
    expect(ship.s).toMatchObject({ partyUserId: fx.users.ship1.userId, grossAmount: 900_000, feeAmount: 36_000, netAmount: 864_000, lotCount: 1 });
    for (const k of ["b1", "b2"]) {
      const b = rows.find((x) => x.s.partyType === "broker" && x.s.partyUserId === fx.users[k].userId)!;
      expect(b.s, k).toMatchObject({ grossAmount: 450_000, feeAmount: 6_750, netAmount: 456_750, lotCount: 1 });
      const [line] = await lines(b.s.id);
      expect(line).toMatchObject({ auctionId: lot, quantity: 50, unitPrice: 9000 });
    }
    expect((await roundSettlementSummary(fx.tenant, r2.id))).toMatchObject({ gross: 900_000, brokerFee: 13_500, allConfirmed: false });
    // pending 정산은 지급 처리 불가
    await expect(markPaid(fx.ctx("op"), ship.s.id)).rejects.toThrow(/확정된 정산만/);
    await fx.update({ tie_break_policy: "first_come" });
  });
});
