import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/context";
import { myIntakeDetail } from "@/services/shipper";
import { AppError } from "@/lib/errors";
import { StatusBadge, Badge } from "@/components/Badge";
import { INTAKE_STATUS, DISPUTE_STATUS, GRADE_LABEL, shipperViewStatus } from "@/domain/status";
import { fmtDateTime, fmtTime, num, unitLabel, won } from "@/lib/format";
import { ObjectionButton } from "./ObjectionButton";

export const metadata = { title: "출하 상세" };
export const dynamic = "force-dynamic";

export default async function ShipperIntakeDetailPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const ctx = await requirePermission(code, "shipper.read_self", { write: false });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof myIntakeDetail>>;
  try { d = await myIntakeDetail(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; }
  const it = d.intake;
  const anonymous = ctx.tenant.winnerDisclosure === "anonymous";
  const overall = d.items.length ? shipperViewStatus(d.items.every((x) => x.auction.status === "settled") ? "settled" : d.items.some((x) => ["awarded", "passed", "disputed"].includes(x.auction.status)) ? (d.items.find((x) => x.auction.status === "disputed") ? "disputed" : "awarded") : d.items[0].auction.status) : null;

  return (
    <>
      <Link href={`/t/${code}/shipper`} className="page-back">‹ 출하 목록</Link>
      <div className="detail-section">
        <div className="flex space-between" style={{ alignItems: "flex-start" }}>
          <h2 style={{ marginBottom: 4 }}>🚢 {d.vesselName}</h2>
          <div className="flex" style={{ gap: 4 }}><StatusBadge map={INTAKE_STATUS} value={it.status} />{overall && it.status !== "draft" && <Badge tone={overall.badge}>{overall.label}</Badge>}</div>
        </div>
        <div className="detail-row"><span className="label">도착 시각</span><span className="value">{fmtDateTime(it.arrivedAt)}</span></div>
        <div className="detail-row"><span className="label">경매 회차</span><span className="value">{d.roundLabel ?? "미배정"}{d.round && <span className="muted small"> · 마감 {fmtTime(d.round.bidCloseAt)}</span>}</span></div>
        <div className="detail-row"><span className="label">품목 수 / 총 중량</span><span className="value">{d.items.length}개 · {num(d.items.reduce((s, x) => s + x.auction.weightKg, 0))}kg</span></div>
        {it.note && <div className="detail-row"><span className="label">참고</span><span className="value">{it.note}</span></div>}
        {it.status === "corrected" && <div className="notice-box" style={{ marginTop: 8, marginBottom: 0 }}>ℹ 입고 확정 후 운영자가 정정한 내역이 있습니다. 상세는 알림함 또는 수협에 문의하세요.</div>}
      </div>

      {d.totals.gross > 0 && (
        <div className="hero-card">
          <div className="hero-label">지급액 미리보기 (낙찰분 기준)</div>
          <div className="hero-value">{won(d.totals.net)}</div>
          <div className="hero-grid">
            <div><div className="k">낙찰 총액</div><div className="v">{won(d.totals.gross)}</div></div>
            <div><div className="k">위판수수료 {num(d.marketFeeRate * 100, 2)}%</div><div className="v">− {won(d.totals.fee)}</div></div>
            <div><div className="k">본인 지급액</div><div className="v">{won(d.totals.net)}</div></div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>정산 확정 시 최종 확정됩니다 · <Link href={`/t/${code}/shipper/settlement`} style={{ color: "#fff", textDecoration: "underline" }}>정산 내역</Link></div>
        </div>
      )}

      <div className="section-title">품목 ({d.items.length})</div>
      {d.items.length === 0 && <div className="empty-state" style={{ padding: "30px 20px" }}><div className="emoji">📦</div>등록된 품목이 없습니다</div>}
      {d.items.map((x) => {
        const a = x.auction;
        const st = shipperViewStatus(a.status);
        const lotDisputes = d.disputes.filter((dd) => dd.dispute.auctionId === a.id);
        const label = `${x.speciesName ?? a.speciesCode} ${GRADE_LABEL[a.grade] ?? a.grade}${a.auctionNo ? ` · ${a.auctionNo}` : ""}`;
        return (
          <div key={a.id} className="lot-row">
            <div className="head">
              <div><div className="title">{x.speciesName ?? a.speciesCode} <span className="muted small">{GRADE_LABEL[a.grade] ?? a.grade}</span></div><div className="no">{a.auctionNo ?? "번호 미부여"}{a.tankNo ? ` · ${a.tankNo}` : ""}</div></div>
              <Badge tone={st.badge}>{st.label}</Badge>
            </div>
            <div className="grid">
              <div><div className="k">중량</div><div className="v">{num(a.weightKg)}kg</div></div>
              <div><div className="k">수량 · 단위</div><div className="v">{num(a.quantity)}{unitLabel(a.unit)}</div></div>
              <div><div className="k">입찰자 수</div><div className="v">{a.bidCount}명</div></div>
              <div><div className="k">낙찰가</div><div className="v">{a.finalPrice != null ? `${won(a.finalPrice)}/${unitLabel(a.unit)}` : a.status === "passed" ? <span className="text-danger">유찰</span> : <span className="muted">대기</span>}</div></div>
              {x.winnerLabel && <div><div className="k">낙찰자 (면허번호)</div><div className="v">{x.winnerLabel}{anonymous && <span className="muted small"> · 수협 정책</span>}</div></div>}
              {a.awardSource && a.awardSource !== "none" && <div><div className="k">낙찰 방식</div><div className="v">{a.awardSource === "field" ? "현장 경매" : "디지털"}{a.awardedAt && <span className="muted small"> · {fmtTime(a.awardedAt)}</span>}</div></div>}
              {a.status === "passed" && a.reservePrice != null && <div><div className="k">최저가(예가)</div><div className="v">{won(a.reservePrice)}</div></div>}
            </div>
            {a.note && <div className="small muted mt-8">참고: {a.note}</div>}
            {x.payout && (
              <div className="payout">
                <span className="muted">낙찰가 × 수량 {won(x.payout.gross)} − 수수료 {won(x.payout.fee)}</span>
                <strong>{won(x.payout.net)}</strong>
              </div>
            )}
            {a.photos.length > 0 && (
              <div className="photo-grid" style={{ marginTop: 10 }}>
                {a.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`${x.speciesName ?? a.speciesCode} 사진`} loading="lazy" /></a>)}
              </div>
            )}
            {lotDisputes.map((dd) => (
              <div key={dd.dispute.id} className="dispute-note">
                <b>이의 제기</b> <StatusBadge map={DISPUTE_STATUS} value={dd.dispute.status} /> · {fmtDateTime(dd.dispute.createdAt)}
                {"\n"}{dd.dispute.reason}
                {dd.dispute.decisionNote && <>{"\n"}<b>처리 결과:</b> {dd.dispute.decisionNote}{dd.dispute.decidedAt && ` (${fmtDateTime(dd.dispute.decidedAt)})`}</>}
              </div>
            ))}
            {(x.canObject || (["awarded", "passed"].includes(a.status) && !ctx.readOnly && lotDisputes.length === 0)) && (
              <div className="actions">
                <span className="deadline">{x.objectionDeadline ? `이의 제기 마감 ${fmtDateTime(x.objectionDeadline)}` : ""}</span>
                {x.canObject ? <ObjectionButton code={code} auctionId={a.id} label={label} deadline={x.objectionDeadline ? fmtDateTime(x.objectionDeadline) : null} /> : <span className="small muted">이의 제기 기한 종료</span>}
              </div>
            )}
          </div>
        );
      })}

      {d.photos.length > 0 && (
        <>
          <div className="section-title">사진 ({d.photos.length}) <span className="muted" style={{ fontWeight: 400 }}>— 입고담당 첨부 · 탭하여 확대</span></div>
          <div className="photo-grid">{d.photos.map((p, i) => <a key={`${p}-${i}`} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={`${p.lot} 사진`} loading="lazy" /></a>)}</div>
        </>
      )}
      <div className="readonly-note mt-16">낙찰자는 면허번호만 표시되며 개인정보는 공개되지 않습니다. 결과에 이의가 있으면 낙찰 후 24시간 이내에 품목별 “이의 제기”를 이용하세요.</div>
    </>
  );
}
