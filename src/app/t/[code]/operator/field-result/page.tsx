import Link from "next/link";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listActiveBrokers, listAuctions } from "@/services/auction";
import { listRoundsWithCounts } from "@/services/dashboard";
import { AUCTION_STATUS, ROUND_STATUS } from "@/domain/status";
import { fmtTime } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";
import { RoundSelect } from "../_components/RoundSelect";
import { FieldResultCard } from "./FieldResultCard";

export const metadata = { title: "현장 결과 입력" };

export default async function FieldResultPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  const tenant = ctx.tenant;

  const rounds = await listRoundsWithCounts(tenant.id, { limit: 30 });
  const selected = rounds.find((r) => r.round.id === sp.round) ?? rounds.find((r) => r.pendingOpenCount > 0) ?? rounds.find((r) => r.lotCount > 0) ?? rounds[0] ?? null;
  const round = selected?.round ?? null;
  const [lots, brokers] = await Promise.all([
    round ? listAuctions(tenant.id, { roundId: round.id, status: ["closed_digital", "field_open"] }) : Promise.resolve([]),
    listActiveBrokers(tenant.id),
  ]);
  const activeBrokers = brokers.filter((b) => b.licenseStatus === "active" || b.licenseStatus == null);
  // 부정 방지: hidden 정책이면 입력 확정 전 디지털가 비노출
  const showDigital = tenant.digitalPriceVisibility === "auctioneer_only" || tenant.digitalPriceVisibility === "public";
  const canWrite = hasPermission(ctx, "auction.field_result") && !ctx.readOnly;

  return (
    <>
      <PageTitle title="현장 결과 입력" uc="Phase 2">
        <Link href={`/t/${code}/operator/results${round ? `?round=${round.id}` : ""}`} className="btn-secondary btn-sm" style={{ display: "inline-block" }}>← 개찰·결과</Link>
        <RoundSelect options={rounds.map((r) => ({ id: r.round.id, label: r.round.label, hint: `${ROUND_STATUS[r.round.status].label} · 대기 ${r.pendingOpenCount}` }))} value={round?.id ?? null} />
      </PageTitle>

      {!tenant.fieldAuctionEnabled && <div className="notice-box">ℹ️ 이 수협은 현장 호가식 경매를 운영하지 않습니다 (디지털 단독). 결과 입력은 가능하지만 스케줄러가 자동 개찰합니다.</div>}
      {!showDigital && <div className="info-box mb-16">🔒 부정 방지 정책: 디지털 최고가는 현장 결과 입력을 확정한 뒤에만 표시됩니다. 현장 호가 결과를 그대로 입력하세요.</div>}
      {round && <p className="muted small">{round.label} · 디지털 마감 {fmtTime(round.bidCloseAt)}{round.fieldStartAt ? ` · 현장 시작 ${fmtTime(round.fieldStartAt)}` : ""} · 입력 대상 {lots.length}건</p>}

      {lots.length === 0 ? (
        <div className="panel"><div className="empty-state"><div className="emoji">🎤</div>현장 결과를 입력할 물품이 없습니다<br /><span className="small">디지털 마감(개찰 대기/현장 경매중) 상태의 물품만 표시됩니다</span></div></div>
      ) : (
        <div className="field-cards">
          {lots.map(({ auction: a, speciesName, vesselName }) => (
            <FieldResultCard key={a.id} code={code} showDigital={showDigital} focus={sp.auction === a.id} canWrite={canWrite}
              brokers={activeBrokers.map((b) => ({ membershipId: b.membershipId, name: b.name, licenseNo: b.licenseNo }))}
              a={{
                id: a.id, auctionNo: a.auctionNo ?? "-", speciesName: speciesName ?? a.speciesCode, grade: a.grade, weightKg: a.weightKg, unit: a.unit, quantity: a.quantity, bidCount: a.bidCount,
                status: a.status, statusLabel: AUCTION_STATUS[a.status].label, vesselName, digitalHighPrice: showDigital ? a.digitalHighPrice : null, reservePrice: a.reservePrice,
                existingField: a.fieldHighPrice != null && a.fieldWinnerMembershipId ? { price: a.fieldHighPrice, winnerMembershipId: a.fieldWinnerMembershipId, note: a.fieldNote } : null,
              }} />
          ))}
        </div>
      )}
    </>
  );
}
