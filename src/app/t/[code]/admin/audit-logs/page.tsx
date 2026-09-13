import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listAuditLogs, distinctActions } from "@/services/tenant-admin";
import { AuditLogTable, auditActionLabel } from "@/components/AuditLogTable";
import { localDateStr, num } from "@/lib/format";

export const metadata = { title: "감사 로그" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditLogsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "audit.read")) notFound();
  const from = sp.from && DATE.test(sp.from) ? sp.from : undefined;
  const to = sp.to && DATE.test(sp.to) ? sp.to : undefined;
  const action = sp.action?.trim() || undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total, pageSize }, actions] = await Promise.all([listAuditLogs(ctx.tenant.id, { from, to, action, q, page, pageSize: 50 }), distinctActions(ctx.tenant.id)]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) => { const u = new URLSearchParams(); if (from) u.set("from", from); if (to) u.set("to", to); if (action) u.set("action", action); if (q) u.set("q", q); u.set("page", String(p)); return `/t/${code}/admin/audit-logs?${u}`; };
  const window = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);

  return (
    <div className="panel">
      <form className="filter-bar" method="get">
        <div className="field"><label>시작일</label><input type="date" name="from" defaultValue={from ?? ""} max={localDateStr()} /></div>
        <div className="field"><label>종료일</label><input type="date" name="to" defaultValue={to ?? ""} max={localDateStr()} /></div>
        <div className="field"><label>구분</label>
          <select name="action" defaultValue={action ?? ""}>
            <option value="">전체</option>
            <option value="tenant.settings%">설정 변경 전체</option>
            <option value="membership.%">멤버/초청 전체</option>
            {actions.map((a) => <option key={a} value={a}>{auditActionLabel(a)} ({a})</option>)}
          </select></div>
        <div className="field grow"><label>검색</label><input name="q" defaultValue={q ?? ""} placeholder="대상 ID·사유·처리자·변경 내용" /></div>
        <div className="actions"><button type="submit" className="btn-secondary">조회</button>{(from || to || action || q) && <Link href={`/t/${code}/admin/audit-logs`} className="btn-ghost" style={{ display: "inline-block", padding: "8px 10px" }}>초기화</Link>}</div>
      </form>
      <div className="panel-header"><h2>감사 로그 <span className="muted small">총 {num(total)}건 · {page}/{pages} 페이지</span></h2><span className="muted small">모든 기록은 영구 보존됩니다</span></div>
      <div className="panel-body dense">
        <AuditLogTable rows={rows} />
        {pages > 1 && (
          <div className="pagination">
            {page > 1 && <Link href={qs(page - 1)} className="btn-secondary" style={{ padding: "6px 10px" }}>‹ 이전</Link>}
            {window.map((p, i) => (
              <span key={p} className="flex" style={{ gap: 6 }}>
                {i > 0 && window[i - 1] < p - 1 && <span className="muted">…</span>}
                {p === page ? <span className="btn-primary" style={{ padding: "6px 10px", borderRadius: 6 }}>{p}</span> : <Link href={qs(p)} className="btn-secondary" style={{ padding: "6px 10px" }}>{p}</Link>}
              </span>
            ))}
            {page < pages && <Link href={qs(page + 1)} className="btn-secondary" style={{ padding: "6px 10px" }}>다음 ›</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
