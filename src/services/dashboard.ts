import "server-only";
import { outer } from "@/db/sql";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auctions, auditLogs, intakes, rounds, settlements, users } from "@/db/schema";
import { withTenant } from "@/db/context";
import { localDateStr } from "@/lib/format";

/** 운영자 대시보드 KPI (오늘 KST 기준) */
export async function operatorKpis(tenantId: string, date = localDateStr()) {
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return withTenant(tenantId, async (tx) => {
    const [{ intakeCount }] = await tx.select({ intakeCount: sql<number>`count(*)::int` }).from(intakes)
      .where(and(eq(intakes.tenantId, tenantId), ne(intakes.status, "deleted"), gte(intakes.arrivedAt, start), lt(intakes.arrivedAt, end)));
    const [{ liveCount, closingCount }] = await tx.select({
      liveCount: sql<number>`count(*)::int`,
      closingCount: sql<number>`count(*) filter (where ${auctions.status} in ('closing','closed_digital','field_open','rebid'))::int`,
    }).from(auctions).where(and(eq(auctions.tenantId, tenantId), inArray(auctions.status, ["open", "closing", "closed_digital", "field_open", "rebid"])));
    const [{ awardedSum, awardedCount }] = await tx.select({
      awardedSum: sql<number>`coalesce(sum(${auctions.finalPrice} * ${auctions.quantity}), 0)::float`,
      awardedCount: sql<number>`count(*)::int`,
    }).from(auctions).where(and(eq(auctions.tenantId, tenantId), inArray(auctions.status, ["awarded", "settled"]), gte(auctions.awardedAt, start), lt(auctions.awardedAt, end)));
    const [{ pendingSettlements }] = await tx.select({ pendingSettlements: sql<number>`count(*)::int` }).from(settlements)
      .where(and(eq(settlements.tenantId, tenantId), eq(settlements.status, "pending")));
    return { intakeCount, liveCount, closingCount, awardedSum: Math.round(awardedSum), awardedCount, pendingSettlements };
  });
}

/** 최근 활동 로그 (audit_logs 는 플랫폼 테이블 — db 직접) */
export async function recentActivity(tenantId: string, limit = 15) {
  return db.select({ log: auditLogs, actorName: users.name }).from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(eq(auditLogs.tenantId, tenantId)).orderBy(desc(auditLogs.at)).limit(limit);
}

type Tone = "success" | "danger" | "warning" | "info" | "muted";
const ACTION_LABEL: Record<string, { label: string; category: string; tone: Tone }> = {
  "intake.create": { label: "입고 등록", category: "입고", tone: "warning" },
  "intake.add_lot": { label: "품목 추가", category: "입고", tone: "warning" },
  "intake.update_lot": { label: "품목 수정", category: "입고", tone: "warning" },
  "intake.remove_lot": { label: "품목 삭제", category: "입고", tone: "warning" },
  "intake.update": { label: "입고 정보 수정", category: "입고", tone: "warning" },
  "intake.confirm": { label: "입고 확정", category: "입고", tone: "warning" },
  "intake.delete": { label: "입고 삭제", category: "입고", tone: "warning" },
  "intake.correct_add": { label: "확정 후 품목 추가 (정정)", category: "정정", tone: "danger" },
  "intake.correct_lot": { label: "품목 정정", category: "정정", tone: "danger" },
  "intake.withdraw_lot": { label: "품목 취소 (정정)", category: "정정", tone: "danger" },
  "notice.send": { label: "경매 공지 발송", category: "공지", tone: "info" },
  "auction.open": { label: "개찰", category: "개찰", tone: "muted" },
  "auction.field_result": { label: "현장 결과 입력", category: "개찰", tone: "muted" },
  "auction.reauction_request": { label: "재개찰 신청", category: "분쟁", tone: "danger" },
  "dispute.objection": { label: "선주 이의 제기", category: "분쟁", tone: "danger" },
  "dispute.approve": { label: "분쟁 승인", category: "분쟁", tone: "danger" },
  "dispute.reject": { label: "분쟁 거부", category: "분쟁", tone: "danger" },
  "bid.create": { label: "입찰", category: "입찰", tone: "info" },
  "bid.modify": { label: "입찰 수정", category: "입찰", tone: "info" },
  "bid.rebid": { label: "재입찰", category: "입찰", tone: "info" },
  "settlement.generate": { label: "정산 생성", category: "정산", tone: "success" },
  "settlement.confirm": { label: "정산 확정", category: "정산", tone: "success" },
  "settlement.paid": { label: "지급 완료", category: "정산", tone: "success" },
  "vessel.create": { label: "선박 등록", category: "마스터", tone: "muted" },
  "vessel.update": { label: "선박 수정", category: "마스터", tone: "muted" },
  "round.create": { label: "회차 생성", category: "일정", tone: "muted" },
  "round.update": { label: "회차 수정", category: "일정", tone: "muted" },
};

export function describeAction(action: string) {
  const known = ACTION_LABEL[action];
  if (known) return known;
  const prefix = action.split(".")[0];
  const category = prefix === "auth" ? "인증" : prefix === "tenant" ? "설정" : prefix === "member" || prefix === "membership" ? "회원" : "기타";
  return { label: action, category, tone: "muted" as Tone };
}

/** 감사 로그 after/before 페이로드에서 표시용 식별자 추출 */
export function activityDetail(log: { after: unknown; before: unknown; reason: string | null; targetType: string | null }) {
  const pick = (v: unknown): string | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    for (const k of ["auctionNo", "settlementNo", "title", "label", "name"]) {
      const x = o[k];
      if (typeof x === "string" && x) return x;
    }
    if (typeof o.created === "number") return `${o.created}건 생성`;
    if (typeof o.lots === "number") return `품목 ${o.lots}건`;
    if (typeof o.items === "number") return `품목 ${o.items}건`;
    if (typeof o.price === "number") return `${o.price.toLocaleString("ko-KR")}원`;
    return null;
  };
  const parts = [pick(log.after) ?? pick(log.before), log.reason ? `사유: ${log.reason}` : null].filter(Boolean);
  return parts.join(" · ");
}

/** 회차 목록 + 물품/낙찰/개찰대기 건수 (회차 선택기용) */
export async function listRoundsWithCounts(tenantId: string, opts: { from?: string; limit?: number } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(rounds.tenantId, tenantId)];
    if (opts.from) conds.push(gte(rounds.date, opts.from));
    return tx.select({
      round: rounds,
      lotCount: sql<number>`(select count(*)::int from ${auctions} a where a.round_id = ${outer(rounds, rounds.id)} and a.status <> 'withdrawn')`,
      awardedCount: sql<number>`(select count(*)::int from ${auctions} a where a.round_id = ${outer(rounds, rounds.id)} and a.status in ('awarded','settled'))`,
      pendingOpenCount: sql<number>`(select count(*)::int from ${auctions} a where a.round_id = ${outer(rounds, rounds.id)} and a.status in ('closed_digital','field_open','rebid'))`,
      settlementCount: sql<number>`(select count(*)::int from ${settlements} s where s.round_id = ${outer(rounds, rounds.id)})`,
    }).from(rounds).where(and(...conds)).orderBy(desc(rounds.date), desc(rounds.seq)).limit(opts.limit ?? 40);
  });
}
export type RoundWithCounts = Awaited<ReturnType<typeof listRoundsWithCounts>>[number];
