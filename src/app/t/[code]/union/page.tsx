import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { todayOverview, type UnionRoundCard } from "@/services/union";
import { StatusBadge } from "@/components/Badge";
import { ROUND_STATUS } from "@/domain/status";
import { fmtTime, fmtDate, num } from "@/lib/format";
import { SubscribeButton } from "./SubscribeButton";

export const metadata = { title: "오늘 일정" };
export const dynamic = "force-dynamic";

function RoundCard({ code, r, canSubscribe }: { code: string; r: UnionRoundCard; canSubscribe: boolean }) {
  const live = r.status === "in_progress" || r.status === "announced" || r.status === "auctioning";
  const c = r.counts;
  return (
    <div className={`round-card${live ? " live" : ""}${r.status === "done" || r.status === "cancelled" ? " done" : ""}`}>
      <div className="head">
        <div><div className="label">{r.label}</div><div className="muted small">{fmtDate(r.date)} · {r.seq}회차</div></div>
        <StatusBadge map={ROUND_STATUS} value={r.status} />
      </div>
      <div className="times">
        <div><div className="k">입찰 시작</div><div className="v">{fmtTime(r.bidStartAt)}</div></div>
        <div><div className="k">입찰 마감</div><div className="v">{fmtTime(r.bidCloseAt)}</div></div>
        <div><div className="k">현장 경매</div><div className="v">{r.fieldStartAt ? fmtTime(r.fieldStartAt) : <span className="muted">-</span>}</div></div>
      </div>
      <div className="counts">
        <span>입고 <strong>{c.intakes}</strong>건</span>
        <span>선박 <strong>{c.vessels}</strong>척</span>
        <span>품목 <strong>{c.lots}</strong></span>
        <span>총 <strong>{num(c.weightKg)}</strong>kg</span>
      </div>
      {c.species.length > 0
        ? <div className="species-chips">{c.species.slice(0, 8).map((s) => <span key={s.code}>{s.name} {num(s.weightKg)}kg</span>)}{c.species.length > 8 && <span>+{c.species.length - 8}</span>}</div>
        : <div className="muted small mt-8">아직 입고된 품목이 없습니다</div>}
      <div className="foot">
        <SubscribeButton code={code} roundId={r.id} initial={r.subscribed} disabled={!canSubscribe} />
        <Link href={`/t/${code}/union/schedule/${r.id}`}>선박·어종 상세 →</Link>
      </div>
    </div>
  );
}

export default async function UnionHomePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requirePermission(code, "union.schedule.read", { write: false });
  const d = await todayOverview(ctx.tenant, ctx.session.userId);
  const canSubscribe = ctx.roles.includes("union") && !(ctx.isPlatformAdmin && !ctx.role);
  const totalKg = d.todayRounds.reduce((s, r) => s + r.counts.weightKg, 0);
  const totalVessels = d.todayRounds.reduce((s, r) => s + r.counts.vessels, 0);

  return (
    <>
      <div className="hero-card">
        <div className="hero-label">{ctx.tenant.name} · {fmtDate(new Date())} 운반 작업 예상</div>
        <div className="hero-value">{d.todayRounds.length}회차 · {num(totalKg)}kg</div>
        <div className="hero-grid">
          <div><div className="k">입항 선박</div><div className="v">{totalVessels}척</div></div>
          <div><div className="k">입고</div><div className="v">{d.todayRounds.reduce((s, r) => s + r.counts.intakes, 0)}건</div></div>
          <div><div className="k">품목</div><div className="v">{d.todayRounds.reduce((s, r) => s + r.counts.lots, 0)}</div></div>
        </div>
      </div>
      <div className="link-row" style={{ justifyContent: "space-between" }}>
        <span className="small muted">가격·낙찰자 정보는 표시되지 않습니다</span>
        <Link href={`/t/${code}/union/schedule`}>🗓 주간 일정 →</Link>
      </div>

      <div className="section-title">오늘 회차 ({d.todayRounds.length})</div>
      {d.todayRounds.length === 0 && <div className="empty-state" style={{ padding: "30px 20px" }}><div className="emoji">📅</div>오늘 예정된 회차가 없습니다<div className="small mt-8">수협 회차 시간표에 등록된 회차가 자동 표시됩니다</div></div>}
      {d.todayRounds.map((r) => <RoundCard key={r.id} code={code} r={r} canSubscribe={canSubscribe} />)}

      {d.tomorrowRounds.length > 0 && (
        <>
          <div className="section-title">내일 예정 ({d.tomorrowRounds.length})</div>
          {d.tomorrowRounds.map((r) => <RoundCard key={r.id} code={code} r={r} canSubscribe={canSubscribe} />)}
        </>
      )}
      <div className="readonly-note mt-16">회차 시각 변경·취소는 필수 알림으로 항상 발송됩니다. “이 회차 알림 받기”는 입고 마감 등 추가 개인 알림용입니다.</div>
    </>
  );
}
