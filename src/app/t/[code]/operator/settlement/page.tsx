import Link from "next/link";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { roundSettlementSummary } from "@/services/settlement";
import { listRoundsWithCounts } from "@/services/dashboard";
import { ROUND_STATUS, SETTLEMENT_STATUS } from "@/domain/status";
import { StatusBadge } from "@/components/Badge";
import { fmtDate, fmtDateTime, num } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";
import { RoundSelect } from "../_components/RoundSelect";
import { MarkPaidButton, SettlementActions } from "./SettlementActions";

export const metadata = { title: "정산" };
const pct = (r: number) => `${Number((r * 100).toFixed(2))}%`;

export default async function SettlementPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  const tenant = ctx.tenant;

  const rounds = await listRoundsWithCounts(tenant.id, { limit: 30 });
  const selected = rounds.find((r) => r.round.id === sp.round) ?? rounds.find((r) => r.awardedCount > 0 || r.settlementCount > 0) ?? rounds[0] ?? null;
  const round = selected?.round ?? null;
  const summary = round ? await roundSettlementSummary(tenant, round.id) : null;
  const canProcess = hasPermission(ctx, "settlement.process") && !ctx.readOnly;
  const pending = summary ? [...summary.shippers, ...summary.brokers].filter((r) => r.s.status === "pending").length : 0;
  const openCount = selected?.pendingOpenCount ?? 0;
  const printHref = (id: string) => `/t/${code}/print/settlement/${id}`;
  const fee = tenant.feePolicy;

  return (
    <>
      <PageTitle title="정산" uc="UC-06">
        {round && <span className="muted small">정산 일자 {fmtDate(round.date)} · 회계 어댑터 {tenant.accountingAdapter}{summary?.allConfirmed ? " · 전체 확정" : ""}</span>}
        <RoundSelect options={rounds.map((r) => ({ id: r.round.id, label: r.round.label, hint: `${ROUND_STATUS[r.round.status].label} · 낙찰 ${r.awardedCount}` }))} value={round?.id ?? null} />
      </PageTitle>

      {!round || !summary ? (
        <div className="panel"><div className="empty-state"><div className="emoji">💰</div>정산할 회차가 없습니다</div></div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-label">낙찰 총액</div><div className="kpi-value">{num(summary.gross)}</div><div className="kpi-delta">원 · 낙찰 {num(selected?.awardedCount ?? 0)}건</div></div>
            <div className="kpi-card"><div className="kpi-label">위판 수수료 ({pct(fee.marketFeeRate)})</div><div className="kpi-value">{num(summary.marketFee)}</div><div className="kpi-delta">원{fee.vatIncluded ? " · VAT 포함" : ` · VAT ${pct(fee.vatRate)} 별도`}</div></div>
            <div className="kpi-card"><div className="kpi-label">중매인 수수료 ({pct(fee.brokerFeeRate)})</div><div className="kpi-value">{num(summary.brokerFee)}</div><div className="kpi-delta">원</div></div>
            <div className="kpi-card"><div className="kpi-label">선주 지급액</div><div className="kpi-value">{num(summary.shipperPayable)}</div><div className="kpi-delta">원</div></div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>선주별 정산 <span className="muted small">({summary.shippers.length}명)</span></h2>
              {canProcess && <div><SettlementActions code={code} roundId={round.id} roundLabel={round.label} pendingCount={pending} awardedCount={selected?.awardedCount ?? 0} openCount={openCount} adapter={tenant.accountingAdapter} /></div>}
            </div>
            <div className="panel-body dense">
              {summary.shippers.length === 0 ? (
                <div className="empty-state" style={{ padding: 30 }}><div className="emoji">🧾</div>{(selected?.awardedCount ?? 0) > 0 ? "정산이 아직 생성되지 않았습니다 — “정산 생성 / 재계산”을 실행하세요" : "낙찰된 물품이 없어 정산할 내역이 없습니다"}</div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>정산번호</th><th>선주</th><th>선박</th><th className="num">낙찰 건수</th><th className="num">낙찰 총액</th><th className="num">위판수수료</th><th className="num">지급액</th><th>상태</th><th></th></tr></thead>
                  <tbody>
                    {summary.shippers.map((r) => (
                      <tr key={r.s.id}>
                        <td className="mono small">{r.s.settlementNo}</td>
                        <td>{r.partyName}{r.bankAccount && <div className="muted small">{r.bankAccount}</div>}</td>
                        <td className="small">{r.vesselNames ?? "-"}</td>
                        <td className="num">{num(r.s.lotCount)}</td><td className="num">{num(r.s.grossAmount)}</td><td className="num">{num(r.s.feeAmount + r.s.vatAmount)}</td><td className="num"><strong>{num(r.s.netAmount)}</strong></td>
                        <td><StatusBadge map={SETTLEMENT_STATUS} value={r.s.status} />{r.s.paidAt && <div className="muted small">{fmtDateTime(r.s.paidAt)}</div>}</td>
                        <td className="actions">
                          <Link href={printHref(r.s.id)} className="btn-secondary btn-sm" style={{ display: "inline-block" }}>정산서</Link>
                          {canProcess && r.s.status === "confirmed" && <MarkPaidButton code={code} settlementId={r.s.id} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><h2>중매인별 정산 <span className="muted small">({summary.brokers.length}명)</span></h2></div>
            <div className="panel-body dense">
              {summary.brokers.length === 0 ? <div className="empty-state" style={{ padding: 30 }}><div className="emoji">🧾</div>중매인 정산 내역이 없습니다</div> : (
                <table className="data-table">
                  <thead><tr><th>정산번호</th><th>중매인</th><th>면허번호</th><th className="num">낙찰 건수</th><th className="num">낙찰 총액</th><th className="num">중매수수료 ({pct(fee.brokerFeeRate)})</th><th className="num">청구액</th><th>상태</th><th></th></tr></thead>
                  <tbody>
                    {summary.brokers.map((r) => (
                      <tr key={r.s.id}>
                        <td className="mono small">{r.s.settlementNo}</td>
                        <td>{r.partyName}</td><td className="mono">{r.licenseNo ?? "-"}</td>
                        <td className="num">{num(r.s.lotCount)}</td><td className="num">{num(r.s.grossAmount)}</td><td className="num">{num(r.s.feeAmount + r.s.vatAmount)}</td><td className="num"><strong>{num(r.s.netAmount)}</strong></td>
                        <td><StatusBadge map={SETTLEMENT_STATUS} value={r.s.status} /></td>
                        <td className="actions">
                          <Link href={printHref(r.s.id)} className="btn-secondary btn-sm" style={{ display: "inline-block" }}>정산서</Link>
                          {canProcess && r.s.status === "confirmed" && <MarkPaidButton code={code} settlementId={r.s.id} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <p className="muted small">지급액 = 낙찰 총액 − 위판수수료{fee.vatIncluded ? "" : " − VAT"} · 청구액 = 낙찰 총액 + 중매인수수료{fee.vatIncluded ? "" : " + VAT"} · 확정된 정산은 재계산되지 않습니다.</p>
        </>
      )}
    </>
  );
}
