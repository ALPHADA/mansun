import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { getUserDetail } from "@/services/platform";
import { Badge, StatusBadge } from "@/components/Badge";
import { AuditLogTable } from "@/components/AuditLogTable";
import { MEMBERSHIP_STATUS, LICENSE_STATUS, TENANT_STATUS } from "@/domain/status";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { UserActions } from "./UserActions";

export const metadata = { title: "사용자 상세" };
export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getUserDetail(id);
  if (!d) notFound();
  const { user: u, memberships, isPlatformAdmin, recentAudit } = d;
  const tenantNames = [...new Set(memberships.filter((m) => m.membership.status === "active").map((m) => m.tenantName))];

  return (
    <>
      <div className="pf-head">
        <div>
          <h2>{u.name} {u.globalSuspended ? <Badge tone="danger">글로벌 정지</Badge> : <Badge tone="success">정상</Badge>} {isPlatformAdmin && <Badge tone="info">Platform Admin</Badge>}</h2>
          <div className="sub"><Link href="/platform/users">← 사용자 검색</Link> · 가입 {fmtDate(u.createdAt)} · 최근 로그인 {fmtDateTime(u.lastLoginAt)}</div>
        </div>
        <div className="action-row"><UserActions userId={u.id} name={u.name} globalSuspended={u.globalSuspended} isPlatformAdmin={isPlatformAdmin} tenantNames={tenantNames} /></div>
      </div>

      <div className="pf-grid">
        <div className="panel">
          <div className="panel-header"><h2>프로필</h2><span className="muted small">최소 PII</span></div>
          <div className="panel-body">
            <dl className="kv wide">
              <dt>이름</dt><dd>{u.name}</dd>
              <dt>이메일</dt><dd>{u.email ?? "-"}</dd>
              <dt>전화</dt><dd className="mono">{u.phone ?? "-"}</dd>
              <dt>본인 인증</dt><dd>{u.identityVerified ? <Badge tone="success">완료</Badge> : <Badge tone="muted">미인증</Badge>}</dd>
              <dt>입금 계좌</dt><dd>{u.bankAccount ? <span className="muted">등록됨 (수협 Admin 화면에서 확인)</span> : "-"}</dd>
              <dt>글로벌 정지</dt><dd>{u.globalSuspended ? <Badge tone="danger">정지</Badge> : "아니오"}</dd>
              <dt>user id</dt><dd><code>{u.id}</code></dd>
            </dl>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h2>소속 수협 · Membership</h2><span className="muted small">{memberships.length}건</span></div>
          <div className="panel-body dense">
            <table className="data-table">
              <thead><tr><th>수협</th><th>역할</th><th>면허 / 작업조</th><th>상태</th><th>가입일</th></tr></thead>
              <tbody>
                {memberships.map(({ membership: m, tenantCode, tenantName, tenantStatus }) => (
                  <tr key={m.id}>
                    <td><Link href={`/platform/tenants/${tenantCode}`}>{tenantName}</Link> {tenantStatus !== "active" && <StatusBadge map={TENANT_STATUS} value={tenantStatus} />}</td>
                    <td>{ROLE_LABEL[m.role]}{m.title && <div className="muted small">{m.title}</div>}</td>
                    <td className="small">
                      {m.role === "broker" && <>{m.licenseNo ?? "-"} {m.licenseStatus && <StatusBadge map={LICENSE_STATUS} value={m.licenseStatus} />}{m.licenseExpiresAt && <div className="muted">만료 {fmtDate(m.licenseExpiresAt)}</div>}</>}
                      {m.role === "union" && (m.squadCode ? <Badge tone="muted">{m.squadCode}</Badge> : "-")}
                      {m.role !== "broker" && m.role !== "union" && "-"}
                    </td>
                    <td><StatusBadge map={MEMBERSHIP_STATUS} value={m.status} />{m.status === "suspended" && m.suspendedAt && <div className="muted small">{fmtDate(m.suspendedAt)}</div>}</td>
                    <td>{fmtDate(m.joinedAt)}</td>
                  </tr>
                ))}
                {memberships.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 20 }}>소속된 수협이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel span-2">
          <div className="panel-header"><h2>관련 감사 로그 (최근 10건)</h2><Link href={`/platform/audit-logs?q=${encodeURIComponent(u.name)}`} className="small">더 보기 →</Link></div>
          <div className="panel-body dense"><AuditLogTable rows={recentAudit.map((r) => ({ ...r, actorName: r.actorUserId === u.id ? u.name : null }))} showTenant /></div>
        </div>
      </div>
    </>
  );
}
