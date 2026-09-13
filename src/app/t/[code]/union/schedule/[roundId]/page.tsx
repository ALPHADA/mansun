import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/context";
import { roundDetail } from "@/services/union";
import { AppError } from "@/lib/errors";
import { StatusBadge, Badge } from "@/components/Badge";
import { ROUND_STATUS } from "@/domain/status";
import { fmtDate, fmtDateTime, fmtTime, num, unitLabel } from "@/lib/format";
import { SubscribeButton } from "../../SubscribeButton";

export const metadata = { title: "회차 상세" };
export const dynamic = "force-dynamic";

export default async function UnionRoundDetailPage({ params }: { params: Promise<{ code: string; roundId: string }> }) {
  const { code, roundId } = await params;
  const ctx = await requirePermission(code, "union.schedule.read", { write: false });
  if (!/^[0-9a-f-]{36}$/i.test(roundId)) notFound();
  let d: Awaited<ReturnType<typeof roundDetail>>;
  try { d = await roundDetail(ctx.tenant, roundId, ctx.session.userId); } catch (e) { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; }
  const r = d.round;
  const canSubscribe = ctx.roles.includes("union") && !(ctx.isPlatformAdmin && !ctx.role);
  const hasConv = Object.keys(ctx.tenant.boxWeightTable).length > 0;

  return (
    <>
      <Link href={`/t/${code}/union/schedule`} className="page-back">‹ 주간 일정</Link>
      <div className="detail-section">
        <div className="flex space-between" style={{ alignItems: "flex-start" }}>
          <h2 style={{ marginBottom: 4 }}>{r.label}</h2>
          <StatusBadge map={ROUND_STATUS} value={r.status} />
        </div>
        <div className="detail-row"><span className="label">일자</span><span className="value">{fmtDate(r.date)} · {r.seq}회차</span></div>
        <div className="detail-row"><span className="label">입찰 시작 / 디지털 마감</span><span className="value">{fmtTime(r.bidStartAt)} / {fmtTime(r.bidCloseAt)}</span></div>
        <div className="detail-row"><span className="label">현장 경매 시작</span><span className="value">{r.fieldStartAt ? fmtTime(r.fieldStartAt) : <span className="muted">현장 경매 미운영</span>}</span></div>
        <div className="detail-row"><span className="label">공지 발송</span><span className="value">{r.autoNoticedAt ? fmtDateTime(r.autoNoticedAt) : <span className="muted">미발송</span>}</span></div>
        <div className="flex space-between mt-8">
          <SubscribeButton code={code} roundId={r.id} initial={d.subscribed} disabled={!canSubscribe} />
          <a href={`/t/${code}/union/schedule/${r.id}/export`} className="btn-secondary small" style={{ padding: "6px 10px" }}>⬇ 어종 요약 CSV</a>
        </div>
      </div>

      <div className="sum-grid">
        <div className="cell"><div className="k">입항 선박</div><div className="v">{d.counts.vessels}척</div></div>
        <div className="cell"><div className="k">품목</div><div className="v">{d.counts.lots}</div></div>
        <div className="cell"><div className="k">총 중량</div><div className="v">{num(d.counts.weightKg)}kg</div></div>
      </div>

      <div className="section-title">선박 도착 순서 ({d.vessels.length})</div>
      <div className="detail-section arrive-list">
        {d.vessels.length === 0 && <div className="muted small">아직 입고된 선박이 없습니다</div>}
        {d.vessels.map((v, i) => (
          <div key={v.intakeId} className="item">
            <span className="seq">{i + 1}</span>
            <div className="name">{v.vesselName}{v.intakeStatus === "draft" && <Badge tone="warning">확정 전</Badge>}<div className="muted small" style={{ fontWeight: 400 }}>{v.species ?? "-"}</div></div>
            <div className="meta">{fmtTime(v.arrivedAt)} 도착<br />{v.lots}품목 · {num(v.weightKg)}kg</div>
          </div>
        ))}
      </div>

      <div className="section-title">어종별 요약 <span className="muted" style={{ fontWeight: 400 }}>— 운반량 산정용</span></div>
      <div className="detail-section" style={{ padding: 0, overflowX: "auto" }}>
        <table className="mini-table">
          <thead><tr><th>어종</th><th className="num">건수</th><th className="num">수량</th><th className="num">중량(kg)</th>{hasConv && <th className="num">환산(kg)</th>}</tr></thead>
          <tbody>
            {d.counts.species.map((s) => (
              <tr key={`${s.code}-${s.unit}`}>
                <td>{s.name}<div className="muted small">{unitLabel(s.unit)} 단위</div></td>
                <td className="num">{s.lots}</td>
                <td className="num">{num(s.quantity)}{unitLabel(s.unit)}</td>
                <td className="num">{num(s.weightKg)}</td>
                {hasConv && <td className="num muted">{num(s.estKg)}</td>}
              </tr>
            ))}
            {d.counts.species.length === 0 && <tr><td colSpan={hasConv ? 5 : 4} className="muted" style={{ textAlign: "center", padding: 20 }}>품목 없음</td></tr>}
          </tbody>
          {d.counts.species.length > 0 && (
            <tfoot><tr><td>합계</td><td className="num">{d.counts.lots}</td><td className="num">-</td><td className="num">{num(d.counts.weightKg)}</td>{hasConv && <td className="num">{num(d.totalEstKg)}</td>}</tr></tfoot>
          )}
        </table>
      </div>
      {hasConv && <div className="small muted">환산(kg)은 수협 단위 환산표(박스/마리 표준 중량) 기준 추정치이며, 미등록 어종은 입고 중량을 그대로 사용합니다.</div>}
      <div className="readonly-note mt-16">노조 화면에는 낙찰가·입찰가·중매인·선주 개인정보·정산 금액이 표시되지 않습니다.</div>
    </>
  );
}
