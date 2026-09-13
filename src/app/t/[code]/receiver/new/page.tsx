import Link from "next/link";
import { requireTenantContext, hasPermission } from "@/lib/auth/context";
import { listVessels, listShippers } from "@/services/vessel";
import { listRounds, currentIntakeRound } from "@/services/round";
import { listSpecies } from "@/services/species";
import { localDateStr, toLocalInput } from "@/lib/format";
import { ROUND_STATUS } from "@/domain/status";
import { IntakeForm } from "./IntakeForm";

export const metadata = { title: "신규 입고" };

export default async function NewIntakePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  const canWrite = !ctx.readOnly && hasPermission(ctx, "intake.write");
  if (!canWrite) {
    return <div className="empty-state"><div className="emoji">🔒</div>읽기 전용 상태에서는 입고를 등록할 수 없습니다<div className="mt-16"><Link href={`/t/${code}/receiver`} className="btn-secondary">입고 메인으로</Link></div></div>;
  }
  const today = localDateStr();
  const [vessels, shippers, species, current, rounds] = await Promise.all([
    listVessels(ctx.tenant.id), listShippers(ctx.tenant.id), listSpecies(), currentIntakeRound(ctx.tenant), listRounds(ctx.tenant.id, { from: today, limit: 20 }),
  ]);
  const now = Date.now();
  const roundOpts = rounds
    .filter((r) => r.status !== "cancelled" && r.status !== "done" && r.bidCloseAt.getTime() > now)
    .sort((a, b) => a.bidCloseAt.getTime() - b.bidCloseAt.getTime())
    .map((r) => ({ id: r.id, label: `${r.label} (${ROUND_STATUS[r.status].label})`, bidCloseAt: r.bidCloseAt.toISOString() }));
  if (current && !roundOpts.some((r) => r.id === current.id)) roundOpts.unshift({ id: current.id, label: `${current.label} (${ROUND_STATUS[current.status].label})`, bidCloseAt: current.bidCloseAt.toISOString() });

  return (
    <>
      <div className="flex mb-8"><Link href={`/t/${code}/receiver`} className="back-btn" style={{ fontSize: 18 }}>‹</Link><h2 style={{ fontSize: 16 }}>신규 입고</h2></div>
      <IntakeForm
        code={code}
        vessels={vessels.map((v) => ({ id: v.id, name: v.name, shipperName: v.shipperName, registrationNo: v.registrationNo }))}
        shippers={shippers.filter((s) => s.status === "active").map((s) => ({ userId: s.userId, name: s.name }))}
        species={species.map((s) => ({ code: s.code, name: s.name, defaultUnit: s.defaultUnit }))}
        rounds={roundOpts}
        defaultRoundId={current?.id ?? roundOpts[0]?.id ?? null}
        defaultArrivedAt={toLocalInput(new Date())}
      />
    </>
  );
}
