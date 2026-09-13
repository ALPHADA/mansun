import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/context";
import { roundDetail } from "@/services/union";
import { audit } from "@/services/audit";
import { AppError } from "@/lib/errors";
import { fmtTime, unitLabel } from "@/lib/format";

const cell = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** GET /t/{code}/union/schedule/{roundId}/export — 회차 어종 요약 + 선박 도착 순서 CSV (가격 없음) */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string; roundId: string }> }) {
  const { code, roundId } = await params;
  const ctx = await requirePermission(code, "union.schedule.read", { write: false });
  if (!/^[0-9a-f-]{36}$/i.test(roundId)) notFound();
  let d: Awaited<ReturnType<typeof roundDetail>>;
  try { d = await roundDetail(ctx.tenant, roundId, ctx.session.userId); } catch (e) { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; }
  const lines: string[] = [];
  lines.push(`# MANSUN ${ctx.tenant.name} ${d.round.label} 어종 요약 · 입찰 ${fmtTime(d.round.bidStartAt)}~${fmtTime(d.round.bidCloseAt)}`);
  lines.push(["어종", "코드", "단위", "건수", "수량", "중량kg", "환산kg"].join(","));
  for (const s of d.counts.species) lines.push([s.name, s.code, unitLabel(s.unit), s.lots, s.quantity, s.weightKg, Math.round(s.estKg)].map(cell).join(","));
  lines.push(["합계", "", "", d.counts.lots, "", d.counts.weightKg, Math.round(d.totalEstKg)].map(cell).join(","));
  lines.push("");
  lines.push(["순번", "선박", "도착시각", "품목수", "중량kg", "어종"].join(","));
  d.vessels.forEach((v, i) => lines.push([i + 1, v.vesselName, fmtTime(v.arrivedAt), v.lots, v.weightKg, v.species ?? ""].map(cell).join(",")));
  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role ?? "union", action: "union.export_csv", targetType: "round", targetId: roundId, after: { species: d.counts.species.length, vessels: d.vessels.length } });
  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mansun-${code}-round-${d.round.date}-${d.round.seq}.csv"`, "Cache-Control": "no-store" },
  });
}
