import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext, hasPermission } from "@/lib/auth/context";
import { getIntake } from "@/services/intake";
import { listSpecies } from "@/services/species";
import { listRounds } from "@/services/round";
import { StatusBadge } from "@/components/Badge";
import { INTAKE_STATUS, ROUND_STATUS } from "@/domain/status";
import { fmtDateTime, localDateStr, num } from "@/lib/format";
import { IntakeDetail } from "./IntakeDetail";

export const metadata = { title: "입고 상세" };

export default async function IntakeDetailPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const ctx = await requireTenantContext(code);
  const [detail, species] = await Promise.all([getIntake(ctx.tenant.id, id), listSpecies()]);
  if (!detail) notFound();
  const it = detail.intake;
  const isStaff = ctx.roles.some((r) => r === "admin" || r === "operator");
  const isDraft = it.status === "draft";
  const canWrite = !ctx.readOnly && hasPermission(ctx, "intake.write") && isDraft && (it.createdBy === ctx.session.userId || isStaff);
  const canConfirm = canWrite && hasPermission(ctx, "intake.confirm");
  const rounds = canConfirm ? (await listRounds(ctx.tenant.id, { from: localDateStr(), limit: 20 })).filter((r) => r.status !== "cancelled" && r.status !== "done" && r.bidCloseAt.getTime() > Date.now()).sort((a, b) => a.bidCloseAt.getTime() - b.bidCloseAt.getTime()) : [];
  const totalWeight = detail.items.reduce((s, a) => s + a.weightKg, 0);

  return (
    <>
      <div className="flex mb-8"><Link href={`/t/${code}/receiver`} className="back-btn" style={{ fontSize: 18 }}>‹</Link><h2 style={{ fontSize: 16 }}>입고 상세</h2></div>
      <div className="detail-section">
        <div className="flex space-between mb-8"><h2 style={{ margin: 0 }}>🚢 {detail.vesselName}</h2><StatusBadge map={INTAKE_STATUS} value={it.status} /></div>
        <div className="detail-row"><span className="label">선주</span><span className="value">{detail.shipperName ?? "미지정"}</span></div>
        <div className="detail-row"><span className="label">도착</span><span className="value">{fmtDateTime(it.arrivedAt)}</span></div>
        <div className="detail-row"><span className="label">회차</span><span className="value">{detail.roundLabel ?? "미지정"}{detail.round && <span className="muted small"> · {ROUND_STATUS[detail.round.status].label}</span>}</span></div>
        <div className="detail-row"><span className="label">품목 / 중량</span><span className="value">{detail.items.length}개 · {num(totalWeight)}kg</span></div>
        {it.note && <div className="detail-row"><span className="label">메모</span><span className="value">{it.note}</span></div>}
        {it.confirmedAt && <div className="detail-row"><span className="label">확정</span><span className="value">{fmtDateTime(it.confirmedAt)}</span></div>}
        <div className="detail-row"><span className="label">등록</span><span className="value">{fmtDateTime(it.createdAt)}{it.createdBy === ctx.session.userId && <span className="muted small"> · 본인</span>}</span></div>
      </div>
      {!isDraft && <div className="readonly-note">🔒 확정된 입고입니다. 확정 후 수정은 운영자 정정이 필요합니다.</div>}
      {isDraft && !canWrite && !ctx.readOnly && <div className="readonly-note">본인이 등록한 입고만 수정할 수 있습니다.</div>}
      <IntakeDetail
        code={code} intakeId={it.id} roundId={it.roundId} canWrite={canWrite} canConfirm={canConfirm}
        species={species.map((s) => ({ code: s.code, name: s.name, defaultUnit: s.defaultUnit }))}
        rounds={rounds.map((r) => ({ id: r.id, label: `${r.label} (${ROUND_STATUS[r.status].label})` }))}
        items={detail.items.map((a) => ({ id: a.id, auctionNo: a.auctionNo, tankNo: a.tankNo, speciesCode: a.speciesCode, weightKg: a.weightKg, unit: a.unit, quantity: a.quantity, grade: a.grade, note: a.note, photos: a.photos, status: a.status, bidCount: a.bidCount, reservePrice: a.reservePrice }))}
      />
    </>
  );
}
