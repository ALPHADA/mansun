import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { listUsers } from "@/services/platform";
import { Badge } from "@/components/Badge";
import { MEMBERSHIP_STATUS } from "@/domain/status";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { fmtDateTime } from "@/lib/format";
import { Pagination } from "../_components/Pagination";

export const metadata = { title: "글로벌 사용자" };
export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await listUsers({ q, page });

  return (
    <>
      <div className="pf-head">
        <div><h2>글로벌 사용자 검색</h2><div className="sub">이름·이메일·전화로 검색 · 다중 소속자는 모든 수협의 역할·상태를 표시 · PII 는 필요한 최소 범위만</div></div>
      </div>
      <div className="panel">
        <form className="filter-bar" method="get">
          <div className="field grow"><label>검색</label><input name="q" defaultValue={q ?? ""} placeholder="이름 · 이메일 · 전화번호" autoFocus /></div>
          <div className="actions"><button className="btn-secondary" type="submit">검색</button>{q && <Link href="/platform/users" className="btn-ghost">초기화</Link>}</div>
        </form>
        <div className="panel-body dense">
          <table className="data-table">
            <thead><tr><th>이름</th><th>이메일</th><th>전화</th><th>소속 수협 · 역할</th><th>상태</th><th>최근 로그인</th><th></th></tr></thead>
            <tbody>
              {r.rows.map(({ user: u, memberships, isPlatformAdmin }) => {
                const byTenant = new Map<string, { name: string; items: typeof memberships }>();
                for (const m of memberships) byTenant.set(m.tenantCode, { name: m.tenantName, items: [...(byTenant.get(m.tenantCode)?.items ?? []), m] });
                return (
                  <tr key={u.id}>
                    <td><Link href={`/platform/users/${u.id}`}>{u.name}</Link>{isPlatformAdmin && <div><Badge tone="info">Platform Admin</Badge></div>}</td>
                    <td className="small">{u.email ?? "-"}</td>
                    <td className="small mono">{u.phone ?? "-"}</td>
                    <td>
                      {[...byTenant.entries()].map(([code, t]) => (
                        <div key={code} className="tenant-line">
                          <Link href={`/platform/tenants/${code}`}>{t.name}</Link>
                          <span className="role-chips">{t.items.map((m) => <Badge key={m.role} tone={m.status === "active" ? "info" : m.status === "suspended" ? "danger" : "warning"}>{ROLE_LABEL[m.role]}{m.licenseNo ? ` ${m.licenseNo}` : ""}{m.status !== "active" ? ` · ${MEMBERSHIP_STATUS[m.status].label}` : ""}</Badge>)}</span>
                        </div>
                      ))}
                      {memberships.length === 0 && <span className="muted small">소속 없음</span>}
                    </td>
                    <td>{u.globalSuspended ? <Badge tone="danger">글로벌 정지</Badge> : <Badge tone="success">정상</Badge>}</td>
                    <td className="small">{fmtDateTime(u.lastLoginAt)}</td>
                    <td><Link href={`/platform/users/${u.id}`} className="btn-secondary btn-sm">상세</Link></td>
                  </tr>
                );
              })}
              {r.rows.length === 0 && <tr><td colSpan={7}><div className="empty-state"><div className="emoji">👥</div>검색 결과가 없습니다</div></td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={r.page} pages={r.pages} total={r.total} params={sp} basePath="/platform/users" />
      </div>
    </>
  );
}
