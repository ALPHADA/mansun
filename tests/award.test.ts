import { describe, it, expect } from "vitest";
import { decideAward, makeAuctionNo, makeSettlementNo, type BidInput } from "@/domain/auction/award";

const t = (s: number) => new Date(2026, 4, 12, 6, 30, s);
const bid = (id: string, price: number, sec: number): BidInput => ({ bidId: id, membershipId: `m-${id}`, price, firstSubmittedAt: t(sec) });

describe("decideAward", () => {
  it("입찰 없음 → 유찰(no_bids)", () => {
    const d = decideAward({ bids: [], tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "passed", reason: "no_bids" });
  });
  it("최고가 단독 → 디지털 낙찰", () => {
    const d = decideAward({ bids: [bid("a", 8000, 1), bid("b", 8200, 2), bid("c", 7900, 3)], tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "awarded", source: "digital", finalPrice: 8200, winnerMembershipId: "m-b" });
  });
  it("예가 미달 → 유찰(below_reserve)", () => {
    const d = decideAward({ bids: [bid("a", 14000, 1)], reservePrice: 15000, tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "passed", reason: "below_reserve", digitalHigh: 14000 });
  });
  it("현장가 > 디지털가 → 현장 낙찰", () => {
    const d = decideAward({ bids: [bid("a", 8200, 1)], field: { price: 8500, membershipId: "m-field" }, tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "awarded", source: "field", finalPrice: 8500, winnerMembershipId: "m-field", digitalHigh: 8200, fieldHigh: 8500 });
  });
  it("현장가 == 디지털가 → 디지털 우선", () => {
    const d = decideAward({ bids: [bid("a", 8500, 1)], field: { price: 8500, membershipId: "m-field" }, tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "awarded", source: "digital", winnerMembershipId: "m-a" });
  });
  it("현장만 있고 디지털 없음 → 현장 낙찰", () => {
    const d = decideAward({ bids: [], field: { price: 5000, membershipId: "m-f" }, tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "awarded", source: "field", finalPrice: 5000 });
  });
  it("동일가 first_come → 최초 제출 시각이 빠른 입찰", () => {
    const d = decideAward({ bids: [bid("late", 8200, 9), bid("early", 8200, 2), bid("mid", 8200, 5)], tieBreak: "first_come" });
    expect(d).toMatchObject({ outcome: "awarded", winnerMembershipId: "m-early", tieBreak: "first_come" });
  });
  it("동일가 lottery → 난수로 결정 (주입)", () => {
    const bids = [bid("a", 8200, 1), bid("b", 8200, 2), bid("c", 8200, 3)];
    expect(decideAward({ bids, tieBreak: "lottery", random: () => 0.0 })).toMatchObject({ winnerMembershipId: "m-a", tieBreak: "lottery" });
    expect(decideAward({ bids, tieBreak: "lottery", random: () => 0.99 })).toMatchObject({ winnerMembershipId: "m-c" });
  });
  it("동일가 split → 균등 분할", () => {
    const d = decideAward({ bids: [bid("a", 8200, 1), bid("b", 8200, 2), bid("c", 8000, 3)], tieBreak: "split" });
    expect(d.outcome).toBe("split");
    if (d.outcome === "split") {
      expect(d.winners).toHaveLength(2);
      expect(d.winners[0].share).toBeCloseTo(0.5);
      expect(d.winners.map((w) => w.membershipId).sort()).toEqual(["m-a", "m-b"]);
    }
  });
  it("동일가 rebid → 재입찰 후보만", () => {
    const d = decideAward({ bids: [bid("a", 8200, 1), bid("b", 8200, 2), bid("c", 8000, 3)], tieBreak: "rebid" });
    expect(d.outcome).toBe("rebid");
    if (d.outcome === "rebid") expect(d.candidates.map((c) => c.bidId).sort()).toEqual(["a", "b"]);
  });
  it("동일가라도 현장가가 더 높으면 동일가 정책 무관 현장 낙찰", () => {
    const d = decideAward({ bids: [bid("a", 8200, 1), bid("b", 8200, 2)], field: { price: 8300, membershipId: "m-f" }, tieBreak: "rebid" });
    expect(d).toMatchObject({ outcome: "awarded", source: "field" });
  });
});

describe("식별자 규약", () => {
  it("경매번호 {code}-{YYYYMMDD}-{회차문자}{순번}", () => {
    expect(makeAuctionNo("gangu", "2026-05-12", 1, 1)).toBe("gangu-20260512-A01");
    expect(makeAuctionNo("gangu", "2026-05-12", 2, 14)).toBe("gangu-20260512-B14");
  });
  it("정산서 번호 {code}-S-{YYYYMM}-{seq4}", () => {
    expect(makeSettlementNo("gangu", "202605", 1)).toBe("gangu-S-202605-0001");
  });
});
