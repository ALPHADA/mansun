import type { FeePolicy, BidUnit, BoxWeightTable } from "@/db/schema";

export interface LotForSettlement {
  auctionId: string;
  unitPrice: number;
  quantity: number;   // 단위 기준 수량
  unit: BidUnit;
}

/** 낙찰 총액 = 단가 × 수량 (원 단위 반올림) */
export function grossOf(lot: { unitPrice: number; quantity: number }) {
  return Math.round(lot.unitPrice * lot.quantity);
}

export interface PartySettlement {
  lotCount: number;
  grossAmount: number;
  feeAmount: number;
  vatAmount: number;
  netAmount: number;
  feeRate: number;
  lines: { auctionId: string; quantity: number; unitPrice: number; grossAmount: number; feeAmount: number }[];
}

/**
 * 선주 정산: 지급액 = 총액 − 위판수수료 (− VAT on fee if vatIncluded=false)
 * 중매인 정산: 청구액 = 총액 + 중매인수수료 (+ VAT on fee)
 */
export function calcParty(lots: LotForSettlement[], policy: FeePolicy, party: "shipper" | "broker"): PartySettlement {
  const feeRate = party === "shipper" ? policy.marketFeeRate : policy.brokerFeeRate;
  const lines = lots.map((l) => {
    const gross = grossOf(l);
    const fee = Math.round(gross * feeRate);
    return { auctionId: l.auctionId, quantity: l.quantity, unitPrice: l.unitPrice, grossAmount: gross, feeAmount: fee };
  });
  const grossAmount = lines.reduce((s, l) => s + l.grossAmount, 0);
  const feeAmount = lines.reduce((s, l) => s + l.feeAmount, 0);
  // vatIncluded=true 이면 수수료에 VAT가 포함되어 있다고 보고 별도 가산 없음
  const vatAmount = policy.vatIncluded ? 0 : Math.round(feeAmount * policy.vatRate);
  const netAmount = party === "shipper" ? grossAmount - feeAmount - vatAmount : grossAmount + feeAmount + vatAmount;
  return { lotCount: lines.length, grossAmount, feeAmount, vatAmount, netAmount, feeRate, lines };
}

/** 단위별 수량 → kg 환산 (통계용) */
export function toKg(quantity: number, unit: BidUnit, speciesCode: string, table: BoxWeightTable, fallbackWeightKg: number) {
  if (unit === "kg") return quantity;
  const conv = table[speciesCode];
  if (unit === "box" && conv?.box) return quantity * conv.box;
  if (unit === "ea" && conv?.ea) return (quantity * conv.ea) / 1000;
  return fallbackWeightKg;
}

/** 입고 시 중량 + 단위 → 단위 수량 계산 */
export function quantityFromWeight(weightKg: number, unit: BidUnit, speciesCode: string, table: BoxWeightTable, explicitQty?: number | null) {
  if (explicitQty && explicitQty > 0) return explicitQty;
  if (unit === "kg") return weightKg;
  const conv = table[speciesCode];
  if (unit === "box" && conv?.box) return Math.max(1, Math.round(weightKg / conv.box));
  if (unit === "ea" && conv?.ea) return Math.max(1, Math.round((weightKg * 1000) / conv.ea));
  return weightKg;
}
