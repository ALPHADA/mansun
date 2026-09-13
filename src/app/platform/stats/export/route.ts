import { requirePlatformAdmin } from "@/lib/auth/context";
import { platformStats } from "@/services/platform";
import { audit } from "@/services/audit";
import { localDateStr } from "@/lib/format";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** GET /platform/stats/export?from=YYYY-MM-DD&to=YYYY-MM-DD — Tenant 별 통계 CSV */
export async function GET(req: Request) {
  const session = await requirePlatformAdmin();
  const url = new URL(req.url);
  const today = localDateStr();
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : `${today.slice(0, 7)}-01`;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;
  const rows = await platformStats(from, to);
  const header = ["code", "수협", "상태", "회차", "로트", "낙찰", "낙찰금액", "평균단가", "회차당로트", "활성중매인", "활성멤버"];
  const lines = rows.map((r) => [r.code, r.name, r.status, r.rounds, r.lots, r.awardedLots, r.awardedAmount, r.avgUnitPrice, r.avgLotsPerRound, r.brokersActive, r.activeMembers].map(cell).join(","));
  const csv = "\uFEFF" + [`# MANSUN 플랫폼 통계 ${from}~${to}`, header.join(","), ...lines].join("\r\n");
  await audit({ actorUserId: session.userId, actorRole: "platform_admin", action: "platform.stats_export", after: { from, to, rows: rows.length } });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mansun-platform-stats-${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
