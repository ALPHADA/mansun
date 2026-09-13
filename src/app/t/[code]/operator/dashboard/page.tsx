import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/context";
import { listIntakes } from "@/services/intake";
import { operatorKpis, recentActivity, describeAction, activityDetail } from "@/services/dashboard";
import { INTAKE_STATUS } from "@/domain/status";
import { StatusBadge, Badge } from "@/components/Badge";
import { fmtDate, fmtTime, localDateStr, num, won } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";

export const metadata = { title: "운영자 대시보드" };

export default async function DashboardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  const today = localDateStr();
  const [kpi, vessels, activity] = await Promise.all([
    operatorKpis(ctx.tenant.id, today),
    listIntakes(ctx.tenant.id, { date: today }),
    recentActivity(ctx.tenant.id, 15),
  ]);
  const base = `/t/${code}/operator`;

  return (
    <>
      <PageTitle title="대시보드"><span className="muted small">{fmtDate(new Date())} · {ctx.tenant.name}</span></PageTitle>

      <div className="kpi-grid">
        <Link href={`${base}/intake`} className="kpi-card kpi-link">
          <div className="kpi-label">오늘 입고 건수</div>
          <div className="kpi-value">{num(kpi.intakeCount)}</div>
          <div className="kpi-delta">선박 기준 · 입고 등록 →</div>
        </Link>
        <Link href={`${base}/results`} className="kpi-card kpi-link">
          <div className="kpi-label">진행중 경매</div>
          <div className="kpi-value">{num(kpi.liveCount)}</div>
          <div className={`kpi-delta${kpi.closingCount ? " down" : ""}`}>{kpi.closingCount ? `마감/개찰 대기 ${kpi.closingCount}건` : "입찰 진행중"}</div>
        </Link>
        <Link href={`${base}/results`} className="kpi-card kpi-link">
          <div className="kpi-label">오늘 낙찰 금액</div>
          <div className="kpi-value">{won(kpi.awardedSum)}</div>
          <div className="kpi-delta">낙찰 {num(kpi.awardedCount)}건</div>
        </Link>
        <Link href={`${base}/settlement`} className="kpi-card kpi-link">
          <div className="kpi-label">정산 대기</div>
          <div className="kpi-value">{num(kpi.pendingSettlements)}</div>
          <div className={`kpi-delta${kpi.pendingSettlements ? " down" : ""}`}>{kpi.pendingSettlements ? "처리 필요" : "대기 건 없음"}</div>
        </Link>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>오늘 입항 선박 <span className="muted small">({vessels.length})</span></h2>
          <Link href={`${base}/intake`}>입고 등록 →</Link>
        </div>
        <div className="panel-body dense">
          {vessels.length === 0 ? <div className="empty-state"><div className="emoji">🚢</div>오늘 입항한 선박이 없습니다</div> : (
            <table className="data-table">
              <thead><tr><th>도착시각</th><th>선박명</th><th>선주</th><th>회차</th><th className="num">품목 수</th><th className="num">총 중량(kg)</th><th>상태</th></tr></thead>
              <tbody>
                {vessels.map((v) => (
                  <tr key={v.id} className="row-link">
                    <td>{fmtTime(v.arrivedAt)}</td>
                    <td><Link href={`${base}/intake?intake=${v.id}`}>{v.vesselName}</Link></td>
                    <td>{v.shipperName ?? "-"}</td>
                    <td className="muted">{v.roundLabel ?? "-"}</td>
                    <td className="num">{num(v.lotCount)}</td>
                    <td className="num">{num(v.totalWeight)}</td>
                    <td><StatusBadge map={INTAKE_STATUS} value={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>최근 활동 로그</h2></div>
        <div className="panel-body dense">
          {activity.length === 0 ? <div className="empty-state"><div className="emoji">📝</div>활동 기록이 없습니다</div> : (
            <table className="data-table">
              <thead><tr><th>시각</th><th>구분</th><th>내용</th><th>처리자</th></tr></thead>
              <tbody>
                {activity.map(({ log, actorName }) => {
                  const d = describeAction(log.action);
                  const detail = activityDetail(log);
                  return (
                    <tr key={log.id}>
                      <td className="mono" title={log.at.toISOString()}>{fmtTime(log.at)}<span className="muted small"> {fmtDate(log.at).slice(5)}</span></td>
                      <td><Badge tone={d.tone}>{d.category}</Badge></td>
                      <td>{d.label}{detail && <span className="muted"> — {detail}</span>}</td>
                      <td>{actorName ?? (log.actorRole === "system" || !log.actorUserId ? "SYSTEM" : "-")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
