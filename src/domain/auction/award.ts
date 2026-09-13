import type { TieBreakPolicy, AwardSource } from "@/db/schema";

export interface BidInput {
  bidId: string;
  membershipId: string;
  price: number;
  /** 최초 제출 시각 (수정해도 선착순 판정은 최초 제출 기준) */
  firstSubmittedAt: Date;
}
export interface FieldResult {
  price: number;
  membershipId: string;
}
export interface AwardInput {
  bids: BidInput[];
  field?: FieldResult | null;
  reservePrice?: number | null;
  tieBreak: TieBreakPolicy;
  /** 테스트 주입용 난수 (0~1) */
  random?: () => number;
}
export type AwardDecision =
  | { outcome: "passed"; reason: "no_bids" | "below_reserve"; digitalHigh: number | null; fieldHigh: number | null }
  | { outcome: "awarded"; source: AwardSource; finalPrice: number; winnerMembershipId: string; winnerBidId: string | null; tieBreak: string | null; digitalHigh: number | null; fieldHigh: number | null }
  | { outcome: "split"; source: "digital"; finalPrice: number; winners: { membershipId: string; bidId: string; share: number }[]; digitalHigh: number | null; fieldHigh: number | null }
  | { outcome: "rebid"; finalPrice: number; candidates: { membershipId: string; bidId: string }[]; digitalHigh: number | null; fieldHigh: number | null };

/**
 * 개찰 결정 (순수 함수).
 * final = max(digital_high, field_high). 현장가와 디지털가가 같으면 디지털 우선(먼저 확정된 결과).
 */
export function decideAward(input: AwardInput): AwardDecision {
  const { bids, field, reservePrice, tieBreak } = input;
  const random = input.random ?? Math.random;
  const digitalHigh = bids.length ? Math.max(...bids.map((b) => b.price)) : null;
  const fieldHigh = field?.price ?? null;

  if (digitalHigh == null && fieldHigh == null) {
    return { outcome: "passed", reason: "no_bids", digitalHigh, fieldHigh };
  }
  const best = Math.max(digitalHigh ?? -Infinity, fieldHigh ?? -Infinity);
  if (reservePrice != null && best < reservePrice) {
    return { outcome: "passed", reason: "below_reserve", digitalHigh, fieldHigh };
  }

  // 현장가가 디지털가보다 높으면 현장 낙찰
  if (fieldHigh != null && field && (digitalHigh == null || fieldHigh > digitalHigh)) {
    return { outcome: "awarded", source: "field", finalPrice: fieldHigh, winnerMembershipId: field.membershipId, winnerBidId: null, tieBreak: null, digitalHigh, fieldHigh };
  }

  // 디지털 낙찰 — 동일가 처리
  const top = bids.filter((b) => b.price === digitalHigh);
  if (top.length === 1) {
    return { outcome: "awarded", source: "digital", finalPrice: digitalHigh!, winnerMembershipId: top[0].membershipId, winnerBidId: top[0].bidId, tieBreak: null, digitalHigh, fieldHigh };
  }
  switch (tieBreak) {
    case "first_come": {
      const w = [...top].sort((a, b) => a.firstSubmittedAt.getTime() - b.firstSubmittedAt.getTime())[0];
      return { outcome: "awarded", source: "digital", finalPrice: digitalHigh!, winnerMembershipId: w.membershipId, winnerBidId: w.bidId, tieBreak: "first_come", digitalHigh, fieldHigh };
    }
    case "lottery": {
      const w = top[Math.min(top.length - 1, Math.floor(random() * top.length))];
      return { outcome: "awarded", source: "digital", finalPrice: digitalHigh!, winnerMembershipId: w.membershipId, winnerBidId: w.bidId, tieBreak: "lottery", digitalHigh, fieldHigh };
    }
    case "split": {
      const share = 1 / top.length;
      return { outcome: "split", source: "digital", finalPrice: digitalHigh!, winners: top.map((b) => ({ membershipId: b.membershipId, bidId: b.bidId, share })), digitalHigh, fieldHigh };
    }
    case "rebid":
      return { outcome: "rebid", finalPrice: digitalHigh!, candidates: top.map((b) => ({ membershipId: b.membershipId, bidId: b.bidId })), digitalHigh, fieldHigh };
  }
}

/** 경매번호: {tenant_code}-{YYYYMMDD}-{회차}{순번2자리} 예) gangu-20260512-1A01 → 명세는 A01 형태이므로 회차를 문자로 */
export function makeAuctionNo(tenantCode: string, dateStr: string, roundSeq: number, seq: number) {
  const roundLetter = String.fromCharCode(64 + Math.max(1, Math.min(26, roundSeq))); // 1→A
  return `${tenantCode}-${dateStr.replace(/-/g, "")}-${roundLetter}${String(seq).padStart(2, "0")}`;
}
export function makeSettlementNo(tenantCode: string, yyyymm: string, seq: number) {
  return `${tenantCode}-S-${yyyymm}-${String(seq).padStart(4, "0")}`;
}
