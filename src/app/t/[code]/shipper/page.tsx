import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { myShipmentsToday } from "@/services/shipper";
import { StatusBadge } from "@/components/Badge";
import { INTAKE_STATUS, shipperViewStatus } from "@/domain/status";
import { fmtTime, fmtDateTime, num, won } from "@/lib/format";
import type { AuctionStatus } from "@/db/schema";

export const metadata = { title: "출하" };
export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof myShipmentsToday>>["today"][number];

function IntakeCard({ code, i, showDate }: { code: string; i: Row; showDate?: boolean }) {
  return (
    <Link href={`/t/${code}/shipper/intake/${i.id}`} className="ship-item">
      <div className="row">
        <div className="vessel">🚢 {i.vesselName}</div>
        <StatusBadge map={INTAKE_STATUS} value={i.status} />
      </div>
      <div className="sub">
        <span>{showDate ? fmtDateTime(i.arrivedAt) : `도착 ${fmtTime(i.arrivedAt)}`}</span>
        <span>{i.roundLabel ?? "회차 미배정"}</span>
        <span>{i.lotCount}품목 · {num(i.totalWeight)}kg</span>
      </div>
      {i.species.length > 0 && <div className="species">{i.species.map((s) => <span key={s}>{s}</span>)}</div>}
      <div className="row mt-8">
        <div className="status-dots" aria-label="품목 상태">{i.lotStatuses.map((s: AuctionStatus, idx: number) => <i key={idx} className={shipperViewStatus(s).badge} title={shipperViewStatus(s).label} />)}</div>
        <div className="pay">{i.expectedPay > 0 ? `예상 지급 ${won(i.expectedPay)}` : <span className="muted small">{i.awarded ? "" : "낙찰 대기"}</span>}</div>
      </div>
    </Link>
  );
}

export default async function ShipperHomePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requirePermission(code, "shipper.read_self", { write: false });
  const d = await myShipmentsToday(ctx);
  const rate = ctx.tenant.feePolicy.marketFeeRate;

  return (
    <>
      <div className="hero-card">
        <div className="hero-label">{ctx.session.name} 선주 · 오늘 출하</div>
        <div className="hero-value">{d.kpi.count}건</div>
        <div className="hero-grid">
          <div><div className="k">총 중량</div><div className="v">{num(d.kpi.weightKg)}kg</div></div>
          <div><div className="k">품목 / 낙찰</div><div className="v">{d.kpi.lots} / {d.kpi.awardedLots}</div></div>
          <div><div className="k">예상 지급액</div><div className="v">{won(d.kpi.expectedPay)}</div></div>
        </div>
        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>예상 지급액 = 낙찰가 × 수량 − 위판수수료 {num(rate * 100, 2)}% · 정산 확정 시 최종 금액이 결정됩니다</div>
      </div>

      <div className="section-title">오늘 출하 ({d.today.length})</div>
      {d.today.length === 0 && <div className="empty-state" style={{ padding: "30px 20px" }}><div className="emoji">🐟</div>오늘 등록된 출하가 없습니다<div className="small mt-8">입고담당이 본인 선박의 입고를 등록하면 여기에 표시됩니다</div></div>}
      {d.today.map((i) => <IntakeCard key={i.id} code={code} i={i} />)}

      <div className="section-title flex space-between">
        <span>최근 7일 요약</span>
        <Link href={`/t/${code}/shipper/vessels`} className="small">선박별 보기 →</Link>
      </div>
      <div className="sum-grid">
        <div className="cell"><div className="k">출하 건수</div><div className="v">{d.week.count}건</div></div>
        <div className="cell"><div className="k">총 중량</div><div className="v">{num(d.week.weightKg)}kg</div></div>
        <div className="cell net"><div className="k">예상 지급 합계</div><div className="v">{won([...d.today, ...d.recent].reduce((s, i) => s + i.expectedPay, 0))}</div></div>
      </div>
      {d.recent.length > 0 && <div className="section-title">최근 출하</div>}
      {d.recent.slice(0, 10).map((i) => <IntakeCard key={i.id} code={code} i={i} showDate />)}
      {d.recent.length > 10 && <div className="text-right small"><Link href={`/t/${code}/shipper/vessels`}>전체 이력은 선박별 보기에서 →</Link></div>}
    </>
  );
}
