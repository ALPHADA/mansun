import Link from "next/link";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { getIntake, listIntakes } from "@/services/intake";
import { listShippers, listVessels } from "@/services/vessel";
import { listSpecies } from "@/services/species";
import { currentIntakeRound, listRounds } from "@/services/round";
import { INTAKE_STATUS } from "@/domain/status";
import { StatusBadge } from "@/components/Badge";
import { fmtTime, localDateStr, num, toLocalInput } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";
import { IntakeWorkspace, type SelectedIntake } from "./IntakeWorkspace";

export const metadata = { title: "입고 등록" };

export default async function IntakePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  const today = localDateStr();
  const tenantId = ctx.tenant.id;

  const [todayIntakes, drafts, vessels, shippers, species, rounds, defaultRound] = await Promise.all([
    listIntakes(tenantId, { date: today }),
    listIntakes(tenantId, { status: ["draft"], limit: 20 }),
    listVessels(tenantId),
    listShippers(tenantId),
    listSpecies(),
    listRounds(tenantId, { from: today, limit: 20 }),
    ctx.readOnly ? Promise.resolve(null) : currentIntakeRound(ctx.tenant),
  ]);
  const seen = new Set<string>();
  const list = [...drafts, ...todayIntakes].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => b.arrivedAt.getTime() - a.arrivedAt.getTime());

  // 선택: ?intake=id | new | 기본(최근 draft, 없으면 새 입고)
  const param = sp.intake;
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const selectedId = param === "new" ? null : param && isUuid(param) ? param : drafts[0]?.id ?? null;
  const detail = selectedId ? await getIntake(tenantId, selectedId) : null;
  const selected: SelectedIntake | null = detail ? {
    id: detail.intake.id, vesselId: detail.intake.vesselId, arrivedAt: toLocalInput(detail.intake.arrivedAt), roundId: detail.intake.roundId,
    status: detail.intake.status, note: detail.intake.note, vesselName: detail.vesselName, shipperName: detail.shipperName, roundLabel: detail.roundLabel,
    roundStatus: detail.round?.status ?? null,
    items: detail.items.map((a) => ({ id: a.id, auctionNo: a.auctionNo, tankNo: a.tankNo, speciesCode: a.speciesCode, weightKg: a.weightKg, unit: a.unit, quantity: a.quantity, grade: a.grade, note: a.note, photos: a.photos, status: a.status, bidCount: a.bidCount })),
  } : null;

  const base = `/t/${code}/operator/intake`;
  const roundOptions = rounds.filter((r) => r.status !== "cancelled" && r.status !== "done").sort((a, b) => a.bidCloseAt.getTime() - b.bidCloseAt.getTime())
    .map((r) => ({ id: r.id, label: `${r.label} (${fmtTime(r.bidCloseAt)} 마감)`, status: r.status }));

  return (
    <>
      <PageTitle title="입고 등록" uc="UC-01">
        {selected ? <span className="muted small">{selected.vesselName} · {selected.arrivedAt.replace("T", " ")}</span> : <span className="muted small">새 입고</span>}
        {!ctx.readOnly && <Link href={`${base}?intake=new`} className="btn-secondary btn-sm" style={{ display: "inline-block" }}>+ 새 입고</Link>}
      </PageTitle>

      <div className="intake-layout">
        <div className="panel">
          <div className="panel-header"><h2>오늘 입고 <span className="muted small">({list.length})</span></h2></div>
          <div className="panel-body dense intake-list">
            {list.length === 0 && <div className="empty-state" style={{ padding: "30px 16px" }}><div className="emoji">📥</div>등록된 입고가 없습니다</div>}
            {list.map((i) => (
              <Link key={i.id} href={`${base}?intake=${i.id}`} className={i.id === selectedId ? "active" : undefined}>
                <div className="title"><span>{i.vesselName}</span><StatusBadge map={INTAKE_STATUS} value={i.status} /></div>
                <div className="sub">{fmtTime(i.arrivedAt)} · {i.shipperName ?? "선주 미지정"} · {num(i.lotCount)}품목 · {num(i.totalWeight)}kg{i.roundLabel ? ` · ${i.roundLabel}` : ""}</div>
              </Link>
            ))}
          </div>
        </div>

        <IntakeWorkspace
          key={selectedId ?? "new"}
          code={code}
          readOnly={ctx.readOnly}
          canCorrect={hasPermission(ctx, "intake.correct") && !ctx.readOnly}
          selected={selected}
          vessels={vessels.map((v) => ({ id: v.id, name: v.name, shipperName: v.shipperName, shipperUserId: v.shipperUserId }))}
          shippers={shippers.filter((s) => s.status === "active").map((s) => ({ userId: s.userId, name: s.name }))}
          species={species.map((s) => ({ code: s.code, name: s.name, defaultUnit: s.defaultUnit }))}
          rounds={roundOptions}
          defaultRoundId={defaultRound?.id ?? roundOptions[0]?.id ?? null}
          nowLocal={toLocalInput(new Date())}
        />
      </div>
    </>
  );
}
