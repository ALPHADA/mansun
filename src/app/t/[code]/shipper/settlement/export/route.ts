import { requirePermission } from "@/lib/auth/context";
import { myLots, mySettlements, lotPayout } from "@/services/shipper";
import { audit } from "@/services/audit";
import { localDateStr, unitLabel } from "@/lib/format";
import { shipperViewStatus } from "@/domain/status";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const cell = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** GET /t/{code}/shipper/settlement/export?from&to — 본인 로트 + 정산 CSV (Self 스코프) */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requirePermission(code, "shipper.read_self", { write: false });
  const url = new URL(req.url);
  const today = localDateStr();
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : `${today.slice(0, 7)}-01`;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;
  const [lots, { rows: settlements }] = await Promise.all([myLots(ctx, { from, to }), mySettlements(ctx, { from, to })]);
  const rate = ctx.tenant.feePolicy.marketFeeRate;
  const anonymous = ctx.tenant.winnerDisclosure === "anonymous";

  const lines: string[] = [];
  lines.push(`# MANSUN ${ctx.tenant.name} 선주 출하 내역 · ${ctx.session.name} · ${from}~${to}`);
  lines.push(["회차일자", "회차", "경매번호", "선박", "어종", "등급", "중량kg", "수량", "단위", "상태", "낙찰가", "낙찰자(면허)", "낙찰총액", "위판수수료", "예상지급액"].join(","));
  for (const l of lots) {
    const a = l.auction; const p = lotPayout(a, rate);
    lines.push([l.round?.date ?? "", l.round?.label ?? "", a.auctionNo, l.vesselName, l.speciesName ?? a.speciesCode, a.grade, a.weightKg, a.quantity, unitLabel(a.unit), shipperViewStatus(a.status).label,
      a.finalPrice, p ? (anonymous ? "비공개" : l.winnerLicense ?? "") : "", p?.gross, p?.fee, p?.net].map(cell).join(","));
  }
  lines.push("");
  lines.push(["정산번호", "회차일자", "회차", "선박", "낙찰건수", "낙찰총액", "위판수수료", "VAT", "지급액", "상태", "확정일", "입금일"].join(","));
  for (const r of settlements) {
    const s = r.s;
    lines.push([s.settlementNo, r.roundDate, r.roundLabel, r.vesselNames, s.lotCount, s.grossAmount, s.feeAmount, s.vatAmount, s.netAmount, s.status, s.confirmedAt?.toISOString() ?? "", s.paidAt?.toISOString() ?? ""].map(cell).join(","));
  }
  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: "shipper", action: "shipper.export_csv", after: { from, to, lots: lots.length, settlements: settlements.length } });
  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mansun-${code}-shipper-${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
