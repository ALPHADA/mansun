import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { getSettlement } from "@/services/settlement";
import { SETTLEMENT_STATUS } from "@/domain/status";
import { StatusBadge } from "@/components/Badge";
import { ROLE_HOME } from "@/lib/authz/matrix";
import { fmtDate, fmtDateTime, num, unitLabel } from "@/lib/format";
import "@/styles/operator-pages.css";
import { PrintControls } from "./PrintControls";

export const metadata = { title: "정산서" };

export default async function SettlementPrintPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const ctx = await requireTenantContext(code);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const s = await getSettlement(ctx.tenant.id, id);
  if (!s) notFound();
  if (!(hasPermission(ctx, "settlement.process") || s.s.partyUserId === ctx.session.userId)) notFound();

  const isShipper = s.s.partyType === "shipper";
  const fee = ctx.tenant.feePolicy;
  const pct = (r: number) => `${Number((r * 100).toFixed(2))}%`;
  const backHref = `/t/${code}${ctx.role ? ROLE_HOME[ctx.role] : "/operator/dashboard"}`;

  return (
    <>
      <PrintControls backHref={backHref} />
      <div className="print-sheet">
        <div className="sheet-head">
          <div>
            <h1 style={{ marginBottom: 4 }}>{isShipper ? "위판 정산서" : "낙찰 대금 청구서"}</h1>
            <div className="org">{ctx.tenant.name}{ctx.tenant.address ? ` · ${ctx.tenant.address}` : ""}{ctx.tenant.businessNo ? ` · 사업자 ${ctx.tenant.businessNo}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono"><strong>{s.s.settlementNo}</strong></div>
            <div className="small"><StatusBadge map={SETTLEMENT_STATUS} value={s.s.status} /></div>
          </div>
        </div>

        <dl className="kv">
          <dt>경매 회차</dt><dd>{s.round.label} ({fmtDate(s.round.date)})</dd>
          <dt>{isShipper ? "선주" : "중매인"}</dt><dd>{s.partyName}{s.licenseNo ? ` · 면허 ${s.licenseNo}` : ""}{s.partyPhone ? ` · ${s.partyPhone}` : ""}</dd>
          {isShipper && s.bankAccount && <><dt>지급 계좌</dt><dd>{s.bankAccount}</dd></>}
          <dt>발행일</dt><dd>{fmtDate(s.s.createdAt)}</dd>
          <dt>확정</dt><dd>{s.s.confirmedAt ? `${fmtDateTime(s.s.confirmedAt)}${s.confirmedByName ? ` · ${s.confirmedByName}` : ""}` : "미확정 (대기)"}</dd>
          <dt>회계 참조</dt><dd className="mono">{s.s.erpRef ?? "-"}</dd>
          {s.s.paidAt && <><dt>지급 완료</dt><dd>{fmtDateTime(s.s.paidAt)}</dd></>}
        </dl>

        <table>
          <thead><tr><th>경매번호</th><th>어종</th><th>등급</th><th>선박</th><th className="num">수량</th><th className="num">단가</th><th className="num">금액</th><th className="num">{isShipper ? "위판수수료" : "중매수수료"}</th></tr></thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.line.id}>
                <td className="mono">{l.auctionNo ?? "-"}</td>
                <td>{l.speciesName ?? "-"}{l.awardSource === "field" && <span className="small"> (현장)</span>}</td>
                <td>{l.grade}</td><td>{l.vesselName}</td>
                <td className="num">{num(l.line.quantity, 1)} {unitLabel(l.unit)}</td>
                <td className="num">{num(l.line.unitPrice)}</td>
                <td className="num">{num(l.line.grossAmount)}</td>
                <td className="num">{num(l.line.feeAmount)}</td>
              </tr>
            ))}
            {s.lines.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center" }}>정산 내역이 없습니다</td></tr>}
          </tbody>
          <tfoot>
            <tr className="totals"><td colSpan={6}>낙찰 총액 ({s.s.lotCount}건)</td><td className="num" colSpan={2}>{num(s.s.grossAmount)}원</td></tr>
            <tr className="totals"><td colSpan={6}>{isShipper ? "위판수수료" : "중매인수수료"} ({pct(s.s.feeRate)}){fee.vatIncluded ? " · VAT 포함" : ""}</td><td className="num" colSpan={2}>{isShipper ? "−" : "+"} {num(s.s.feeAmount)}원</td></tr>
            {s.s.vatAmount > 0 && <tr className="totals"><td colSpan={6}>부가세 ({pct(fee.vatRate)})</td><td className="num" colSpan={2}>{isShipper ? "−" : "+"} {num(s.s.vatAmount)}원</td></tr>}
            <tr className="totals"><td colSpan={6}><strong>{isShipper ? "지급액" : "청구액"}</strong></td><td className="num" colSpan={2}><strong>{num(s.s.netAmount)}원</strong></td></tr>
          </tfoot>
        </table>

        <div className="foot">
          <p>본 정산서는 MANSUN 시스템에서 발행되었습니다. 문의: {ctx.tenant.contactPhone ?? ctx.tenant.contactEmail ?? ctx.tenant.name}</p>
          {s.s.status === "pending" && <p>※ 미확정 정산서입니다. 확정 전 금액은 변경될 수 있습니다.</p>}
        </div>
      </div>
    </>
  );
}
