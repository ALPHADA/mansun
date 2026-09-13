import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/context";
import { listSettlements } from "@/services/settlement";
import { StatusBadge } from "@/components/Badge";
import { SETTLEMENT_STATUS } from "@/domain/status";
import { fmtDateTime, localDateStr, num, won } from "@/lib/format";

export const metadata = { title: "내 정산 내역" };

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function BrokerSettlementPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  const today = localDateStr();
  const from = isDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.to) ? sp.to : today;

  const all = await listSettlements(ctx.tenant.id, { partyType: "broker", partyUserId: ctx.session.userId });
  const rows = all.filter((r) => r.roundDate >= from && r.roundDate <= to);
  const sum = (k: "grossAmount" | "feeAmount" | "vatAmount" | "netAmount") => rows.reduce((s, r) => s + r.s[k], 0);
  const feeRate = ctx.tenant.feePolicy.brokerFeeRate;
  const pendingCount = rows.filter((r) => r.s.status === "pending").length;

  return (
    <>
      <form className="period-form" method="get">
        <div><label>시작일</label><input type="date" name="from" defaultValue={from} /></div>
        <div><label>종료일</label><input type="date" name="to" defaultValue={to} /></div>
        <button className="btn-secondary" type="submit">조회</button>
      </form>

      <div className="hero-card">
        <div className="hero-label">{from} ~ {to} · 낙찰 {rows.reduce((s, r) => s + r.s.lotCount, 0)}건 · 정산 {rows.length}건</div>
        <div className="hero-value">{won(sum("netAmount"))}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>청구액 (낙찰 총액 + 중매수수료{sum("vatAmount") > 0 ? " + VAT" : ""})</div>
        <div className="hero-grid">
          <div><div className="k">낙찰 총액</div><div className="v">{won(sum("grossAmount"))}</div></div>
          <div><div className="k">중매수수료 ({num(feeRate * 100, 2)}%)</div><div className="v">{won(sum("feeAmount"))}</div></div>
          <div><div className="k">{sum("vatAmount") > 0 ? "VAT" : "미확정"}</div><div className="v">{sum("vatAmount") > 0 ? won(sum("vatAmount")) : `${pendingCount}건`}</div></div>
        </div>
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
              <div className="sub">{issued ? `확정 ${fmtDateTime(s.confirmedAt)}${s.status === "paid" ? ` · 납부 ${fmtDateTime(s.paidAt)}` : " · 미납"}` : "운영자 확정 대기 (금액 변동 가능)"}</div>
              {issued && <Link href={`/t/${code}/print/settlement/${s.id}`} className="btn-secondary small" style={{ padding: "6px 10px" }}>정산서 보기</Link>}
            </div>
          </div>
        );
      })}
    </>
  );
}
