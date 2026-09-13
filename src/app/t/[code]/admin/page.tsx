import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { adminKpis, listAuditLogs, listExpiringLicenses } from "@/services/tenant-admin";
import { listDisputes } from "@/services/auction";
import { kpiToday } from "@/services/stats";
import { speciesMap } from "@/services/species";
import { AuditLogTable } from "@/components/AuditLogTable";
import { StatusBadge } from "@/components/Badge";
import { LICENSE_STATUS } from "@/domain/status";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { fmtDate, num, won } from "@/lib/format";
import { DisputePanel, type DisputeItem } from "./DisputePanel";

export const metadata = { title: "관리 홈" };

export default async function AdminHomePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "tenant.settings.read")) notFound();
  const base = `/t/${code}/admin`;
  const [kpi, today, disputes, expiring, recent, species] = await Promise.all([
    adminKpis(ctx.tenant.id), kpiToday(ctx.tenant.id), listDisputes(ctx.tenant.id, { status: ["open"] }),
    listExpiringLicenses(ctx.tenant.id, 30), listAuditLogs(ctx.tenant.id, { action: "tenant.settings%", pageSize: 8 }), speciesMap(),
  ]);
  const canDecide = !ctx.readOnly && hasPermission(ctx, "auction.reauction.approve");
  const items: DisputeItem[] = disputes.map((d) => ({
    id: d.dispute.id, kind: d.dispute.kind, reason: d.dispute.reason, createdAt: d.dispute.createdAt.toISOString(),
    auctionNo: d.auctionNo, speciesName: species[d.speciesCode]?.name ?? d.speciesCode, raisedByName: d.raisedByName, raisedRole: d.dispute.raisedRole, finalPrice: d.finalPrice,
  }));

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">활성 멤버</div>
          <div className="kpi-value"><Link href={`${base}/members`}>{num(kpi.activeMembers)}</Link></div>
          <div className="kpi-sub">{(["admin", "operator", "receiver", "broker", "shipper", "union"] as const).filter((r) => kpi.activeByRole[r] > 0).map((r) => `${ROLE_LABEL[r]} ${kpi.activeByRole[r]}`).join(" · ") || "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">중매인 / 면허 만료 임박(30일)</div>
          <div className="kpi-value"><Link href={`${base}/brokers`}>{num(kpi.brokers)} <span className={kpi.expiringLicenses ? "text-danger" : "muted"} style={{ fontSize: 18 }}>/ {kpi.expiringLicenses}</span></Link></div>
          <div className="kpi-sub">{kpi.expiringLicenses ? "만료 임박 면허를 갱신하세요" : "만료 임박 면허 없음"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">대기중 초청</div>
          <div className="kpi-value"><Link href={`${base}/members`}>{num(kpi.pendingInvites)}</Link></div>
          <div className="kpi-sub">7일 내 수락 필요</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">미처리 분쟁/재개찰</div>
          <div className={`kpi-value${kpi.openDisputes ? " text-danger" : ""}`}>{num(kpi.openDisputes)}</div>
          <div className="kpi-sub">승인/거부 대기</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">오늘 거래 ({today.date})</div>
          <div className="kpi-value">{num(today.awarded)}<span className="muted" style={{ fontSize: 14 }}> / {num(today.lots)}건</span></div>
          <div className="kpi-sub">낙찰액 {won(today.amount)} · 유찰 {today.passed} · 진행중 {today.inProgress}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>승인 대기 분쟁 / 재개찰 신청</h2><span className="muted small">{items.length}건</span></div>
        <div className="panel-body">
          <DisputePanel code={code} items={items} canWrite={canDecide} />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header"><h2>면허 만료 임박 (30일 이내)</h2><Link href={`${base}/brokers`} className="small">면허 관리 →</Link></div>
          <div className="panel-body dense">
            {expiring.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>만료 임박 면허가 없습니다</div> : (
              <table className="data-table">
                <thead><tr><th>중매인</th><th>면허번호</th><th>상태</th><th>만료일</th></tr></thead>
                <tbody>
                  {expiring.map((e) => (
                    <tr key={e.membershipId}>
                      <td>{e.name}</td><td className="mono">{e.licenseNo ?? "-"}</td>
                      <td>{e.licenseStatus && <StatusBadge map={LICENSE_STATUS} value={e.licenseStatus} />}</td>
                      <td>{fmtDate(e.licenseExpiresAt)} <span className={`days-left ${e.daysLeft != null && e.daysLeft <= 7 ? "danger" : "warn"}`}>{e.daysLeft != null && e.daysLeft < 0 ? `${-e.daysLeft}일 경과` : `D-${e.daysLeft}`}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>빠른 액션</h2></div>
          <div className="panel-body">
            <div className="quick-btns" style={{ marginBottom: 0 }}>
              <Link href={`${base}/members?invite=1`} className="btn-primary" style={{ display: "inline-block" }}>+ 멤버 초청</Link>
              <Link href={`${base}/settings?tab=fees`} className="btn-secondary" style={{ display: "inline-block" }}>수수료 설정</Link>
              <Link href={`${base}/shippers`} className="btn-secondary" style={{ display: "inline-block" }}>선주 등록</Link>
              <Link href={`${base}/stats`} className="btn-secondary" style={{ display: "inline-block" }}>통계 보기</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>최근 설정 변경</h2><Link href={`${base}/audit-logs?action=tenant.settings%25`} className="small">감사 로그 전체 →</Link></div>
        <div className="panel-body dense">
          <AuditLogTable rows={recent.rows} />
        </div>
      </div>
    </>
  );
}
