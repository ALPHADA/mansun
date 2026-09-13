import { describe, it, expect } from "vitest";
import { calcParty, grossOf, quantityFromWeight, toKg } from "@/domain/settlement/calc";
import type { FeePolicy } from "@/db/schema";

const policy: FeePolicy = { marketFeeRate: 0.04, brokerFeeRate: 0.015, vatIncluded: true, vatRate: 0.1 };
const lots = [
  { auctionId: "a1", unitPrice: 8200, quantity: 320, unit: "kg" as const },     // 2,624,000
  { auctionId: "a2", unitPrice: 48000, quantity: 11, unit: "box" as const },    // 528,000
];

describe("정산 계산", () => {
  it("총액 = 단가 × 수량", () => {
    expect(grossOf(lots[0])).toBe(2_624_000);
    expect(grossOf({ unitPrice: 1800, quantity: 540 })).toBe(972_000);
  });
  it("선주: 지급액 = 총액 − 위판수수료(4%)", () => {
    const s = calcParty(lots, policy, "shipper");
    expect(s.grossAmount).toBe(3_152_000);
    expect(s.feeAmount).toBe(Math.round(2_624_000 * 0.04) + Math.round(528_000 * 0.04));
    expect(s.netAmount).toBe(s.grossAmount - s.feeAmount);
    expect(s.vatAmount).toBe(0);
    expect(s.lotCount).toBe(2);
  });
  it("중매인: 청구액 = 총액 + 중매인수수료(1.5%)", () => {
    const b = calcParty(lots, policy, "broker");
    expect(b.feeRate).toBe(0.015);
    expect(b.netAmount).toBe(b.grossAmount + b.feeAmount);
  });
  it("VAT 별도 정책이면 수수료에 VAT 가산", () => {
    const p: FeePolicy = { ...policy, vatIncluded: false };
    const s = calcParty(lots, p, "shipper");
    expect(s.vatAmount).toBe(Math.round(s.feeAmount * 0.1));
    expect(s.netAmount).toBe(s.grossAmount - s.feeAmount - s.vatAmount);
  });
  it("mockup 수치 재현: 42,720,000 낙찰 → 위판수수료 1,708,800 / 중매수수료 640,800 / 지급액 41,011,200", () => {
    const one = [{ auctionId: "x", unitPrice: 42_720_000, quantity: 1, unit: "kg" as const }];
    expect(calcParty(one, policy, "shipper")).toMatchObject({ feeAmount: 1_708_800, netAmount: 41_011_200 });
    expect(calcParty(one, policy, "broker").feeAmount).toBe(640_800);
  });
});

describe("단위 환산", () => {
  const table = { hairtail: { box: 20 }, squid: { ea: 400 } };
  it("kg 단위는 중량 그대로", () => expect(quantityFromWeight(320, "kg", "mackerel", table)).toBe(320));
  it("박스: 중량/박스중량 반올림, 명시 수량 우선", () => {
    expect(quantityFromWeight(220, "box", "hairtail", table)).toBe(11);
    expect(quantityFromWeight(220, "box", "hairtail", table, 12)).toBe(12);
  });
  it("마리: g 환산", () => expect(quantityFromWeight(216, "ea", "squid", table)).toBe(540));
  it("환산표 없으면 중량 fallback", () => expect(quantityFromWeight(100, "box", "unknown", table)).toBe(100));
  it("toKg 역환산", () => {
    expect(toKg(11, "box", "hairtail", table, 0)).toBe(220);
    expect(toKg(540, "ea", "squid", table, 0)).toBe(216);
    expect(toKg(50, "kg", "mackerel", table, 0)).toBe(50);
  });
});
