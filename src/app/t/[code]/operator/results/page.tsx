import Link from "next/link";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listAuctions, listDisputes } from "@/services/auction";
import { listRoundsWithCounts } from "@/services/dashboard";
import { Badge, StatusBadge } from "@/components/Badge";
import { AUCTION_STATUS, DISPUTE_STATUS, ROUND_STATUS, TIE_BREAK_LABEL, VISIBILITY_LABEL } from "@/domain/status";
import { fmtDateTime, fmtTime, num, unitLabel, won } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";
import { RoundSelect } from "../_components/RoundSelect";
import { TickButton } from "../_components/TickButton";
import { BulkOpenButton, RowActions } from "./RowActions";

export const metadata = { title: "개찰 · 결과" };

const AFTER_AWARD = new Set(["awarded", "passed", "settled", "disputed"]);
const PENDING = new Set(["closed_digital", "field_open", "rebid"]);

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  const tenant = ctx.tenant;

  const rounds = await listRoundsWithCounts(tenant.id, { limit: 30 });
  const selected = rounds.find((r) => r.round.id === sp.round) ?? rounds.find((r) => r.lotCount > 0) ?? rounds[0] ?? null;
  const round = selected?.round ?? null;
  const [lots, disputes] = await Promise.all([
    round ? listAuctions(tenant.id, { roundId: round.id }) : Promise.resolve([]),
    listDisputes(tenant.id, { status: ["open", "approved"] }),
  ]);

  const done = lots.filter((l) => AFTER_AWARD.has(l.auction.status)).length;
  const passed = lots.filter((l) => l.auction.status === "passed").length;
  const total = lots.filter((l) => l.auction.status === "awarded" || l.auction.status === "settled").reduce((s, l) => s + (l.auction.finalPrice ?? 0) * l.auction.quantity, 0);
  const pendingCount = lots.filter((l) => l.auction.status === "closed_digital" || l.auction.status === "field_open").length;
  const canOpen = hasPermission(ctx, "auction.open") && !ctx.readOnly;
  const canReauction = hasPermission(ctx, "auction.reauction.request") && !ctx.readOnly;
  const showTick = process.env.NODE_ENV !== "production" && !ctx.readOnly;

  return (
    <>
      <PageTitle title="개찰 · 결과" uc="UC-04 · UC-05">
        {round && <span className="muted small">디지털 마감 {fmtTime(round.bidCloseAt)}{round.fieldStartAt ? ` → 현장 경매 ${fmtTime(round.fieldStartAt)}` : ""}{tenant.fieldAuctionEnabled ? " (Phase 2 병행)" : ""}</span>}
        {showTick && <TickButton />}
        <RoundSelect options={rounds.map((r) => ({ id: r.round.id, label: r.round.label, hint: `${ROUND_STATUS[r.round.status].label} · ${r.lotCount}품목` }))} value={round?.id ?? null} />
      </PageTitle>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">개찰 대상</div><div className="kpi-value">{num(lots.length)}</div><div className="kpi-delta">{round?.label ?? "-"}</div></div>
        <div className="kpi-card"><div className="kpi-label">개찰 완료</div><div className="kpi-value">{num(done)}</div><div className={`kpi-delta${lots.length - done ? " down" : ""}`}>{num(lots.length - done)} 대기</div></div>
        <div className="kpi-card"><div className="kpi-label">총 낙찰 금액</div><div className="kpi-value">{won(total)}</div><div className="kpi-delta">낙찰 {num(done - passed)}건</div></div>
        <div className="kpi-card"><div className="kpi-label">유찰</div><div className="kpi-value">{num(passed)}</div><div className="kpi-delta">{passed ? "재공지 검토" : ""}</div></div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>{round ? `${round.label} — 경매 진행 현황` : "회차 없음"} {round && <StatusBadge map={ROUND_STATUS} value={round.status} />}</h2>
          {round && canOpen && (
            <div>
              {tenant.fieldAuctionEnabled && pendingCount > 0 && <Link href={`/t/${code}/operator/field-result?round=${round.id}`} className="btn-secondary" style={{ display: "inline-block" }}>현장 결과 입력</Link>}
              <BulkOpenButton code={code} roundId={round.id} count={pendingCount} />
            </div>
          )}
        </div>
        <div className="panel-body dense">
          {lots.length === 0 ? <div className="empty-state"><div className="emoji">🔨</div>이 회차에 물품이 없습니다</div> : (
            <table className="data-table">
              <thead><tr>
                <th>경매번호</th><th>어종</th><th>단위</th><th className="num">입찰자 수</th><th className="num">디지털 최고가</th><th className="num">현장 최고가</th><th className="num">최종 낙찰가</th><th>낙찰자</th><th>출처</th><th>상태</th><th></th>
              </tr></thead>
              <tbody>
                {lots.map(({ auction: a, speciesName, winnerName, winnerLicense }) => {
                  const showDigital = AFTER_AWARD.has(a.status) || (PENDING.has(a.status) && tenant.digitalPriceVisibility !== "hidden");
                  return (
                    <tr key={a.id}>
                      <td className="mono small">{a.auctionNo ?? "-"}</td>
                      <td>{speciesName ?? a.speciesCode} <span className="muted small">{a.grade}등급 · {num(a.weightKg, 1)}kg</span></td>
                      <td>{unitLabel(a.unit)}</td>
                      <td className="num">{num(a.bidCount)}</td>
                      <td className="num">{showDigital ? (a.digitalHighPrice != null ? num(a.digitalHighPrice) : <span className="muted">없음</span>) : <span className="muted" title="개찰 전 비공개">🔒 비공개</span>}</td>
                      <td className="num">{a.fieldHighPrice != null ? num(a.fieldHighPrice) : <span className="muted">—</span>}</td>
                      <td className="num">{a.finalPrice != null ? <strong>{num(a.finalPrice)}</strong> : <span className="muted">—</span>}</td>
                      <td>{winnerName ? <>{winnerName}{winnerLicense && tenant.winnerDisclosure === "license_no" ? <span className="muted small"> ({winnerLicense})</span> : null}</> : <span className="muted">—</span>}</td>
                      <td>{a.awardSource === "digital" ? <Badge tone="info">디지털</Badge> : a.awardSource === "field" ? <Badge tone="warning">현장</Badge> : a.awardSource === "none" ? <Badge tone="muted">유찰</Badge> : <span className="muted">—</span>}</td>
                      <td><StatusBadge map={AUCTION_STATUS} value={a.status} />{a.status === "rebid" && a.rebidUntil && <div className="muted small">~{fmtTime(a.rebidUntil)}</div>}</td>
                      <td className="actions">
                        <RowActions code={code} auctionId={a.id} auctionNo={a.auctionNo ?? ""} roundId={a.roundId ?? round?.id ?? ""} status={a.status} hasField={a.fieldHighPrice != null} hybrid={tenant.fieldAuctionEnabled} canOpen={canOpen} canReauction={canReauction} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header"><h2>동일가 / 분쟁 정책</h2></div>
          <div className="panel-body">
            <ul className="policy-list">
              <li><strong>동일가:</strong> {TIE_BREAK_LABEL[tenant.tieBreakPolicy]}</li>
              <li><strong>디지털가 공개:</strong> {VISIBILITY_LABEL[tenant.digitalPriceVisibility]}</li>
              <li><strong>입찰 수정:</strong> {tenant.bidModificationAllowed ? "마감 전 수정 허용 (선착순 판정은 최초 제출 기준)" : "불가 — 1회 제출로 확정"}</li>
              <li><strong>현장 호가식:</strong> {tenant.fieldAuctionEnabled ? `병행 (디지털 마감 + ${tenant.digitalCloseBufferMin}분 후 시작) · 최종가 = max(디지털, 현장)` : "미운영 (디지털 단독)"}</li>
              <li><strong>낙찰자 공개:</strong> {tenant.winnerDisclosure === "license_no" ? "면허번호 공개" : "익명"}</li>
            </ul>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>분쟁 / 재개찰 현황 <span className="muted small">({disputes.length})</span></h2></div>
          <div className="panel-body dense">
            {disputes.length === 0 ? <p className="muted" style={{ margin: 0, padding: 18 }}>현재 검토중인 분쟁·재개찰 건이 없습니다.</p> : (
              <table className="data-table">
                <thead><tr><th>경매번호</th><th>종류</th><th>사유</th><th>신청자</th><th>상태</th><th>시각</th></tr></thead>
                <tbody>
                  {disputes.map((d) => (
                    <tr key={d.dispute.id}>
                      <td className="mono small">{d.auctionNo ?? "-"}</td>
                      <td>{d.dispute.kind === "reauction" ? <Badge tone="danger">재개찰</Badge> : <Badge tone="warning">이의제기</Badge>}</td>
                      <td className="small">{d.dispute.reason}</td>
                      <td>{d.raisedByName}</td>
                      <td><StatusBadge map={DISPUTE_STATUS} value={d.dispute.status} /></td>
                      <td className="small muted">{fmtDateTime(d.dispute.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
