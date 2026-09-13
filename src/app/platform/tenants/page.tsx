import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { listTenants } from "@/services/platform";
import { StatusBadge } from "@/components/Badge";
import { TENANT_STATUS } from "@/domain/status";
import { fmtDate, num } from "@/lib/format";
import type { TenantStatus } from "@/db/schema";

export const metadata = { title: "수협(Tenant) 목록" };
export const dynamic = "force-dynamic";

const STATUSES: TenantStatus[] = ["pending", "active", "suspended", "archived"];
const isStatus = (s: string | undefined): s is TenantStatus => !!s && (STATUSES as string[]).includes(s);

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const q = sp.q?.trim() || undefined;
  const rows = await listTenants({ status, q });

  return (
    <>
      <div className="pf-head">
        <div><h2>수협(Tenant) 목록</h2><div className="sub">{rows.length}개 · 등록·활성화·정지·아카이브는 상세 화면에서 처리합니다</div></div>
        <div className="actions"><Link href="/platform/tenants/new" className="btn-primary">+ 수협 등록</Link></div>
      </div>

      <div className="panel">
        <form className="filter-bar" method="get">
          <div className="field grow"><label>검색</label><input name="q" defaultValue={q ?? ""} placeholder="code · 이름 · 지역" /></div>
          <div className="field"><label>상태</label>
            <select name="status" defaultValue={status ?? ""}>
              <option value="">전체</option>
              {STATUSES.map((s) => <option key={s} value={s}>{TENANT_STATUS[s].label}</option>)}
            </select>
          </div>
          <div className="actions"><button className="btn-secondary" type="submit">조회</button>{(q || status) && <Link href="/platform/tenants" className="btn-ghost">초기화</Link>}</div>
        </form>
        <div className="panel-body dense">
          <table className="data-table">
            <thead><tr><th>code</th><th>이름</th><th>지역</th><th>상태</th><th className="num">활성 멤버</th><th className="num">오늘 거래</th><th>생성일</th><th>활성화일</th><th>액션</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><code>{t.code}</code></td>
                  <td><Link href={`/platform/tenants/${t.code}`}>{t.name}</Link>{t.status === "suspended" && t.suspendReason && <div className="small text-danger" title={t.suspendReason}>사유: {t.suspendReason.length > 30 ? `${t.suspendReason.slice(0, 30)}…` : t.suspendReason}</div>}</td>
                  <td>{t.region ?? "-"}</td>
                  <td><StatusBadge map={TENANT_STATUS} value={t.status} /></td>
                  <td className="num">{num(t.memberCount)}</td>
                  <td className="num">{t.status === "active" ? num(t.todayLots) : <span className="muted">-</span>}</td>
                  <td>{fmtDate(t.createdAt)}</td>
                  <td>{fmtDate(t.activatedAt)}</td>
                  <td><Link href={`/platform/tenants/${t.code}`} className="btn-secondary btn-sm">상세</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9}><div className="empty-state"><div className="emoji">🏢</div>조건에 맞는 수협이 없습니다</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
