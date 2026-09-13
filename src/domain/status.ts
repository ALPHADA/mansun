import type { AuctionStatus, IntakeStatus, RoundStatus, BidStatus, SettlementStatus, TenantStatus, MembershipStatus, LicenseStatus, DisputeStatus } from "@/db/schema";

type Badge = "success" | "danger" | "warning" | "info" | "muted";

export const AUCTION_STATUS: Record<AuctionStatus, { label: string; badge: Badge }> = {
  registered: { label: "입고완료", badge: "muted" },
  announced: { label: "공지됨", badge: "info" },
  open: { label: "입찰중", badge: "info" },
  closing: { label: "마감임박", badge: "warning" },
  closed_digital: { label: "개찰 대기", badge: "warning" },
  field_open: { label: "현장 경매중", badge: "warning" },
  rebid: { label: "재입찰중", badge: "warning" },
  awarded: { label: "낙찰", badge: "success" },
  passed: { label: "유찰", badge: "danger" },
  disputed: { label: "분쟁", badge: "danger" },
  settled: { label: "정산완료", badge: "success" },
  withdrawn: { label: "취소", badge: "muted" },
};
export const INTAKE_STATUS: Record<IntakeStatus, { label: string; badge: Badge }> = {
  draft: { label: "입고대기", badge: "warning" },
  confirmed: { label: "입고완료", badge: "success" },
  announced: { label: "경매중", badge: "info" },
  corrected: { label: "정정됨", badge: "warning" },
  deleted: { label: "삭제", badge: "muted" },
};
export const ROUND_STATUS: Record<RoundStatus, { label: string; badge: Badge }> = {
  scheduled: { label: "예정", badge: "muted" },
  announced: { label: "공지됨", badge: "info" },
  in_progress: { label: "입찰중", badge: "info" },
  auctioning: { label: "개찰중", badge: "warning" },
  done: { label: "완료", badge: "success" },
  cancelled: { label: "취소", badge: "danger" },
};
export const BID_STATUS: Record<BidStatus, { label: string; badge: Badge }> = {
  submitted: { label: "유효", badge: "info" },
  closed: { label: "마감", badge: "muted" },
  awarded: { label: "낙찰", badge: "success" },
  lost: { label: "패찰", badge: "muted" },
  invalid: { label: "무효", badge: "danger" },
};
export const SETTLEMENT_STATUS: Record<SettlementStatus, { label: string; badge: Badge }> = {
  pending: { label: "대기", badge: "warning" },
  confirmed: { label: "확정", badge: "success" },
  paid: { label: "지급완료", badge: "success" },
};
export const TENANT_STATUS: Record<TenantStatus, { label: string; badge: Badge }> = {
  pending: { label: "준비중", badge: "warning" },
  active: { label: "운영중", badge: "success" },
  suspended: { label: "정지", badge: "danger" },
  archived: { label: "아카이브", badge: "muted" },
};
export const MEMBERSHIP_STATUS: Record<MembershipStatus, { label: string; badge: Badge }> = {
  invited: { label: "초청중", badge: "warning" },
  active: { label: "활성", badge: "success" },
  suspended: { label: "정지", badge: "danger" },
};
export const LICENSE_STATUS: Record<LicenseStatus, { label: string; badge: Badge }> = {
  active: { label: "유효", badge: "success" },
  expired: { label: "만료", badge: "warning" },
  suspended: { label: "정지", badge: "danger" },
  revoked: { label: "취소", badge: "muted" },
};
export const DISPUTE_STATUS: Record<DisputeStatus, { label: string; badge: Badge }> = {
  open: { label: "검토중", badge: "warning" },
  approved: { label: "승인", badge: "success" },
  rejected: { label: "거부", badge: "danger" },
  resolved: { label: "종결", badge: "muted" },
};

/** 선주 관점 출하 상태 매핑 */
export function shipperViewStatus(s: AuctionStatus): { label: string; badge: Badge } {
  switch (s) {
    case "registered": return { label: "입항", badge: "muted" };
    case "announced": case "open": case "closing": case "closed_digital": case "field_open": case "rebid":
      return { label: "경매중", badge: "info" };
    case "awarded": return { label: "낙찰", badge: "success" };
    case "passed": return { label: "유찰", badge: "danger" };
    case "disputed": return { label: "이의제기", badge: "danger" };
    case "settled": return { label: "정산완료", badge: "success" };
    case "withdrawn": return { label: "취소", badge: "muted" };
  }
}

export const GRADE_LABEL: Record<string, string> = { A: "A등급", B: "B등급", C: "C등급" };
export const TIE_BREAK_LABEL: Record<string, string> = {
  first_come: "동일 최고가 시 선착순(먼저 제출한 입찰) 낙찰",
  lottery: "동일 최고가 시 추첨으로 낙찰자 결정",
  split: "동일 최고가 시 분할 낙찰",
  rebid: "동일 최고가 시 해당 입찰자 재입찰",
};
export const VISIBILITY_LABEL: Record<string, string> = {
  hidden: "옵션 A — 디지털 최고가 비공개 (현장 경매 종료 후 자동 비교)",
  auctioneer_only: "옵션 B — 경매인에게만 디지털 최고가 공개",
  public: "옵션 C — 전체 공개",
};
