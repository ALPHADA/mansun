import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { mySettlements } from "@/services/shipper";
import { StatusBadge } from "@/components/Badge";
import { SETTLEMENT_STATUS } from "@/domain/status";
import { fmtDateTime, localDateStr, num, won } from "@/lib/format";

export const metadata = { title: "정산 내역" };
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shift = (d: string, days: number) => localDateStr(new Date(new Date(`${d}T12:00:00+09:00`).getTime() + days * 86_400_000));

export default async function ShipperSettlementPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(code, "shipper.read_self", { write: false });
  const today = localDateStr();
  const from = isDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.to) ? sp.to : today;
  const { rows, summary } = await mySettlements(ctx, { from, to });
  const feeRate = ctx.tenant.feePolicy.marketFeeRate;
  const pendingCount = rows.filter((r) => r.s.status === "pending").length;
  const ranges = [{ label: "이번 달", f: `${today.slice(0, 7)}-01`, t: today }, { label: "30일", f: shift(today, -29), t: today }, { label: "90일", f: shift(today, -89), t: today }, { label: "올해", f: `${today.slice(0, 4)}-01-01`, t: today }];

  return (
    <>
      <div className="quick-range">{ranges.map((r) => <Link key={r.label} href={`/t/${code}/shipper/settlement?from=${r.f}&to=${r.t}`} className={r.f === from && r.t === to ? "active" : undefined}>{r.label}</Link>)}</div>
      <form className="period-form" method="get">
        <div><label>시작일</label><input type="date" name="from" defaultValue={from} /></div>
        <div><label>종료일</label><input type="date" name="to" defaultValue={to} /></div>
        <button className="btn-secondary" type="submit">조회</button>
      </form>

      <div className="hero-card">
        <div className="hero-label">{from} ~ {to} · 낙찰 {summary.lots}건 · 정산 {rows.length}건</div>
        <div className="hero-value">{won(summary.net)}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>지급액 (낙찰 총액 − 위판수수료{summary.vat > 0 ? " − VAT" : ""})</div>
        <div className="hero-grid">
          <div><div className="k">낙찰 총액</div><div className="v">{won(summary.gross)}</div></div>
          <div><div className="k">위판수수료 ({num(feeRate * 100, 2)}%)</div><div className="v">{won(summary.fee)}</div></div>
          <div><div className="k">{summary.vat > 0 ? "VAT" : "미확정"}</div><div className="v">{summary.vat > 0 ? won(summary.vat) : `${pendingCount}건`}</div></div>
        </div>
      </div>

      <div className="link-row">
        <a href={`/t/${code}/shipper/settlement/export?from=${from}&to=${to}`}>⬇ CSV (본인 데이터)</a>
      </div>

      {rows.length === 0 && <div className="empty-state"><div className="emoji">💰</div>해당 기간의 정산 내역이 없습니다<div className="small mt-8">정산은 회차 개찰 종료 후 운영자가 생성·확정합니다</div></div>}

      {rows.map((r) => {
        const s = r.s;
        const issued = s.status === "confirmed" || s.status === "paid";
        return (
          <div key={s.id} className="settle-item">
            <div className="row">
              <div><div style={{ fontWeight: 600 }}>{r.roundLabel}</div><div className="no">{s.settlementNo}</div></div>
              <StatusBadge map={SETTLEMENT_STATUS} value={s.status} />
            </div>
            <div className="row mt-8">
              <div className="sub">낙찰 {s.lotCount}건 · 총액 {won(s.grossAmount)} · 수수료 {won(s.feeAmount)}{s.vatAmount > 0 ? ` · VAT ${won(s.vatAmount)}` : ""}</div>
              <div className="amount">{won(s.netAmount)}</div>
            </div>
            {r.vesselNames && <div className="sub">선박: {r.vesselNames}</div>}
            <div className="row mt-8">
              <div className="sub">{issued ? `확정 ${fmtDateTime(s.confirmedAt)}${s.status === "paid" ? ` · 입금 ${fmtDateTime(s.paidAt)}` : " · 입금 대기"}` : "운영자 확정 대기 (금액 변동 가능)"}</div>
              {issued && <Link href={`/t/${code}/print/settlement/${s.id}`} className="btn-secondary small" style={{ padding: "6px 10px" }}>정산서 보기</Link>}
            </div>
          </div>
        );
      })}
      <div className="readonly-note mt-16">정산서(PDF 인쇄)는 운영자가 <b>확정</b>한 정산에 대해서만 제공됩니다. 입금 계좌는 마이페이지에서 변경할 수 있습니다.</div>
    </>
  );
}
