import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { platformKpis, listTenants, platformAuditLogs } from "@/services/platform";
import { StatusBadge } from "@/components/Badge";
import { TENANT_STATUS } from "@/domain/status";
import { AuditLogTable } from "@/components/AuditLogTable";
import { fmtDate, num, won } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import type { Role } from "@/db/schema";

export const metadata = { title: "플랫폼 대시보드" };
export const dynamic = "force-dynamic";

export default async function PlatformDashboardPage() {
  await requirePlatformAdmin();
  const [kpi, tenants, audit] = await Promise.all([platformKpis(), listTenants(), platformAuditLogs({ page: 1 })]);
  const suspended = tenants.filter((t) => t.status === "suspended");
  const pending = tenants.filter((t) => t.status === "pending");
  const roles = Object.keys(kpi.membershipsByRole) as Role[];

  return (
    <>
      <div className="pf-head">
        <div><h2>플랫폼 대시보드</h2><div className="sub">모든 수협(Tenant)의 운영 현황 — 도메인 데이터는 읽기 전용</div></div>
        <div className="actions"><Link href="/platform/tenants/new" className="btn-primary">+ 수협 등록</Link></div>
      </div>

      <div className="kpi-grid">
        <Link href="/platform/tenants" className="kpi-card link"><div className="kpi-label">전체 수협</div><div className="kpi-value">{kpi.tenantsTotal}</div><div className="kpi-sub">최근 7일 +{kpi.recentTenants7d} · 30일 +{kpi.recentTenants30d}</div></Link>
        <Link href="/platform/tenants?status=active" className="kpi-card link tone-success"><div className="kpi-label">운영중</div><div className="kpi-value">{kpi.tenantsByStatus.active}</div><div className="kpi-sub">준비중 {kpi.tenantsByStatus.pending}</div></Link>
        <Link href="/platform/tenants?status=suspended" className={`kpi-card link${kpi.tenantsByStatus.suspended ? " tone-danger" : ""}`}><div className="kpi-label">정지</div><div className="kpi-value">{kpi.tenantsByStatus.suspended}</div><div className="kpi-sub">아카이브 {kpi.tenantsByStatus.archived}</div></Link>
        <div className="kpi-card"><div className="kpi-label">오늘 거래 건수 (전체)</div><div className="kpi-value">{num(kpi.today.lots)}</div><div className="kpi-sub">입찰 {num(kpi.today.bids)}건</div></div>
        <div className="kpi-card"><div className="kpi-label">오늘 낙찰 금액 (전체)</div><div className="kpi-value">{won(kpi.today.awardedAmount)}</div><div className="kpi-sub">낙찰가 × 수량 합계</div></div>
        <Link href="/platform/users" className="kpi-card link"><div className="kpi-label">전체 사용자</div><div className="kpi-value">{num(kpi.usersTotal)}</div><div className="kpi-sub">{roles.map((r) => `${ROLE_LABEL[r]} ${kpi.membershipsByRole[r]}`).join(" · ")}</div></Link>
      </div>

      {(suspended.length > 0 || pending.length > 0) && (
        <div className="panel">
          <div className="panel-header"><h2>주의가 필요한 수협</h2><span className="muted small">정지 {suspended.length} · 활성화 대기 {pending.length}</span></div>
          <div className="panel-body">
            {suspended.map((t) => (
              <div key={t.id} className="alert-card">
                <div><div className="title">⚠ {t.name} <span className="muted small">({t.code})</span></div><div className="reason">{t.suspendReason ?? "사유 미기재"} · 정지일 {fmtDate(t.suspendedAt)}</div></div>
                <Link href={`/platform/tenants/${t.code}`} className="btn-secondary btn-sm">상세 · 해제</Link>
              </div>
            ))}
            {pending.map((t) => (
              <div key={t.id} className="alert-card pending">
                <div><div className="title">⏳ {t.name} <span className="muted small">({t.code})</span></div><div className="reason">활성화 대기 — 초기 Admin 가입 여부 확인 후 활성화하세요 · 등록 {fmtDate(t.createdAt)}</div></div>
                <Link href={`/platform/tenants/${t.code}`} className="btn-secondary btn-sm">상세 · 활성화</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header"><h2>수협 현황</h2><Link href="/platform/tenants" className="small">전체 보기 →</Link></div>
        <div className="panel-body dense">
          <table className="data-table">
            <thead><tr><th>code</th><th>이름</th><th>지역</th><th>상태</th><th className="num">활성 멤버</th><th className="num">오늘 거래</th><th>활성화일</th></tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/platform/tenants/${t.code}`}><code>{t.code}</code></Link></td>
                  <td><Link href={`/platform/tenants/${t.code}`}>{t.name}</Link></td>
                  <td>{t.region ?? "-"}</td>
                  <td><StatusBadge map={TENANT_STATUS} value={t.status} /></td>
                  <td className="num">{num(t.memberCount)}</td>
                  <td className="num">{t.status === "active" ? num(t.todayLots) : <span className="muted">-</span>}</td>
                  <td>{fmtDate(t.activatedAt)}</td>
                </tr>
              ))}
              {tenants.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 30 }}>등록된 수협이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>최근 플랫폼 감사 로그</h2><Link href="/platform/audit-logs" className="small">전체 보기 →</Link></div>
        <div className="panel-body dense"><AuditLogTable rows={audit.rows.slice(0, 10)} showTenant /></div>
      </div>
    </>
  );
}
