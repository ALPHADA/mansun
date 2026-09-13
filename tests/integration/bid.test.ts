import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { placeBid, myBidFor } from "@/services/bid";

const fx = new TenantFixture();
let roundId: string, vesselId: string;

beforeAll(async () => {
  await fx.create();
  await fx.addUser("op", "operator"); await fx.addUser("ship", "shipper");
  await fx.addUser("b1", "broker", { licenseNo: "T-001" }); await fx.addUser("b2", "broker", { licenseNo: "T-002" });
  await fx.addUser("bx", "broker", { licenseNo: "T-009", licenseStatus: "suspended" });
  vesselId = await fx.addVessel("테스트호", "ship");
  roundId = (await fx.addRound()).id;
});
afterAll(() => fx.destroy());

describe("placeBid", () => {
  it("신규 입찰 → bids 1건, bid_count 증가", async () => {
    const lot = await fx.addLot(roundId, vesselId);
    const r = await placeBid(fx.ctx("b1"), lot.id, { price: 8200 });
    expect(r.modified).toBe(false);
    expect((await fx.auction(lot.id)).bidCount).toBe(1);
    const mine = await myBidFor(fx.ctx("b1"), lot.id);
    expect(mine?.price).toBe(8200);
  });
  it("수정 허용 정책 → revision 증가 + 이력 보존, bid_count 유지", async () => {
    const lot = await fx.addLot(roundId, vesselId);
    await placeBid(fx.ctx("b1"), lot.id, { price: 8000 });
    const r = await placeBid(fx.ctx("b1"), lot.id, { price: 8500 });
    expect(r.modified).toBe(true);
    expect(r.bid.revision).toBe(2);
    const revs = await fx.q`select * from bid_revisions where bid_id = ${r.bid.id}`;
    expect(revs).toHaveLength(1);
    expect((await fx.auction(lot.id)).bidCount).toBe(1);
  });
  it("수정 불허 정책 → 1회 확정", async () => {
    await fx.update({ bid_modification_allowed: false });
    const lot = await fx.addLot(roundId, vesselId);
    await placeBid(fx.ctx("b1"), lot.id, { price: 8000 });
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 9000 })).rejects.toThrow(/수정을 허용하지/);
    await fx.update({ bid_modification_allowed: true });
  });
  it("예가 미달 거부", async () => {
    const lot = await fx.addLot(roundId, vesselId, { species: "flatfish", reservePrice: 15000 });
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 14000 })).rejects.toThrow(/최저가/);
  });
  it("면허 정지 중매인 거부", async () => {
    const lot = await fx.addLot(roundId, vesselId);
    await expect(placeBid(fx.ctx("bx"), lot.id, { price: 8000 })).rejects.toThrow(/면허/);
  });
  it("마감된 회차(서버 시각) 거부 — 상태가 open 이어도 마감 시각이 우선", async () => {
    const closed = await fx.addRound({ seq: 9, startsInMin: -60, closesInMin: -1 });
    const lot = await fx.addLot(closed.id, vesselId);
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 8000 })).rejects.toThrow(/마감/);
  });
  it("운영자는 입찰 불가, 0원/소수 입찰가 거부", async () => {
    const lot = await fx.addLot(roundId, vesselId);
    await expect(placeBid(fx.ctx("op"), lot.id, { price: 8000 })).rejects.toThrow(/중매인만/);
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 0 })).rejects.toThrow();
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 100.5 })).rejects.toThrow();
  });
  it("다른 테넌트의 물품에는 입찰 불가 (RLS + 앱 필터)", async () => {
    const other = new TenantFixture(); await other.create();
    await other.addUser("s", "shipper"); const v = await other.addVessel("타사호", "s"); const r = await other.addRound();
    const lot = await other.addLot(r.id, v);
    await expect(placeBid(fx.ctx("b1"), lot.id, { price: 8000 })).rejects.toThrow(/찾을 수 없/);
    await other.destroy();
  });
});
