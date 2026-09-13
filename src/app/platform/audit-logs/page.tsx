import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { platformAuditLogs, tenantOptions, auditActionPrefixes } from "@/services/platform";
import { AuditLogTable } from "@/components/AuditLogTable";
import { Pagination } from "../_components/Pagination";

export const metadata = { title: "플랫폼 감사 로그" };
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s: string | undefined): s is string => !!s && /^[0-9a-f-]{36}$/i.test(s);

export default async function PlatformAuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const filter = {
    tenantId: isUuid(sp.tenantId) ? sp.tenantId : undefined,
    from: isDate(sp.from) ? sp.from : undefined, to: isDate(sp.to) ? sp.to : undefined,
    action: sp.action?.trim() || undefined, q: sp.q?.trim() || undefined,
    page: Math.max(1, Number(sp.page) || 1),
  };
  const [r, tenants, prefixes] = await Promise.all([platformAuditLogs(filter), tenantOptions(), auditActionPrefixes()]);
  const hasFilter = !!(filter.tenantId || filter.from || filter.to || filter.action || filter.q);

  return (
    <>
      <div className="pf-head">
        <div><h2>플랫폼 감사 로그</h2><div className="sub">모든 수협의 IAM·Tenant 라이프사이클·도메인 이벤트 + Platform Admin 조회 이력 · 50건/페이지</div></div>
      </div>
      <div className="panel">
        <form className="filter-bar" method="get">
          <div className="field"><label>수협</label>
            <select name="tenantId" defaultValue={filter.tenantId ?? ""}>
              <option value="">전체 (플랫폼 포함)</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
            </select>
          </div>
          <div className="field"><label>구분(접두어)</label>
            <select name="action" defaultValue={filter.action ?? ""}>
              <option value="">전체</option>
              {prefixes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field"><label>시작일</label><input type="date" name="from" defaultValue={filter.from ?? ""} /></div>
          <div className="field"><label>종료일</label><input type="date" name="to" defaultValue={filter.to ?? ""} /></div>
          <div className="field grow"><label>검색</label><input name="q" defaultValue={filter.q ?? ""} placeholder="action · 대상 id · 처리자 · 사유" /></div>
          <div className="actions"><button className="btn-secondary" type="submit">조회</button>{hasFilter && <Link href="/platform/audit-logs" className="btn-ghost">초기화</Link>}</div>
        </form>
        <div className="panel-body dense"><AuditLogTable rows={r.rows} showTenant /></div>
        <Pagination page={r.page} pages={r.pages} total={r.total} params={sp} basePath="/platform/audit-logs" />
      </div>
    </>
  );
}
