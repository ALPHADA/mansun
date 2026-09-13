import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listAllBids } from "@/services/bid";
import { audit } from "@/services/audit";
import { BID_STATUS, AUCTION_STATUS } from "@/domain/status";
import { fmtDateTime, localDateStr, unitLabel } from "@/lib/format";
import { parseBidFilters } from "../filters";

export const dynamic = "force-dynamic";

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /t/{code}/operator/bids/export?round=&broker=&species=&status=&q=&from=&to= → UTF-8 BOM CSV */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "bids.read_all")) return new Response("forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { opts } = parseBidFilters(sp);
  const rows = await listAllBids(ctx.tenant.id, { ...opts, limit: 5000 });

  const header = ["경매번호", "회차", "어종", "중매인", "면허번호", "입찰가", "단위", "수정횟수", "재입찰", "입찰 시각", "최초 제출 시각", "입찰 상태", "경매 상태", "낙찰가", "메모"];
  const lines = rows.map((r) => [
    r.auctionNo, r.roundLabel, r.speciesName ?? r.speciesCode, r.brokerName, r.licenseNo, r.bid.price, unitLabel(r.unit), r.bid.revision - 1, r.bid.isRebid ? "Y" : "",
    fmtDateTime(r.bid.submittedAt, { second: "2-digit" }), fmtDateTime(r.bid.firstSubmittedAt, { second: "2-digit" }), BID_STATUS[r.bid.status].label, AUCTION_STATUS[r.auctionStatus].label, r.finalPrice, r.bid.memo,
  ].map(csvCell).join(","));
  const body = "\uFEFF" + [header.join(","), ...lines].join("\r\n");

  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "bids.export", targetType: "tenant", targetId: ctx.tenant.id, after: { rows: rows.length, filters: opts } });
  const filename = `bids_${ctx.tenant.code}_${localDateStr()}.csv`;
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
