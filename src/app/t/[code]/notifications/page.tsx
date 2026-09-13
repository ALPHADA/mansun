import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/context";
import { listNotifications } from "@/services/notification";
import { fmtDateTime } from "@/lib/format";
import { markAllReadAction, markReadAction } from "./actions";
import { ROLE_HOME } from "@/lib/authz/matrix";

export const metadata = { title: "알림함" };

export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ scope?: string }> }) {
  const { code } = await params;
  const { scope } = await searchParams;
  const ctx = await requireTenantContext(code);
  const all = scope === "all";
  const rows = await listNotifications(ctx.session.userId, { tenantId: all ? null : ctx.tenant.id });
  const home = `/t/${code}${ctx.role ? ROLE_HOME[ctx.role] : ""}`;
  return (
    <div className="mobile-frame" style={{ paddingBottom: 24 }}>
      <header className="mobile-header">
        <div className="flex"><Link href={home} className="back-btn" aria-label="뒤로">‹</Link><h1>알림함</h1></div>
        <form action={markAllReadAction}><input type="hidden" name="code" value={code} /><button className="btn-ghost small">모두 읽음</button></form>
      </header>
      <div className="tabs" style={{ margin: "0 16px" }}>
        <Link href={`/t/${code}/notifications`} className={!all ? "active" : ""}>{ctx.tenant.name}</Link>
        <Link href={`/t/${code}/notifications?scope=all`} className={all ? "active" : ""}>전체 수협</Link>
      </div>
      {rows.length === 0 && <div className="empty-state"><div className="emoji">🔔</div>알림이 없습니다</div>}
      {rows.map(({ n, tenantName, tenantCode }) => (
        <form key={n.id} action={markReadAction}>
          <input type="hidden" name="code" value={code} /><input type="hidden" name="id" value={n.id} />
          <input type="hidden" name="link" value={n.link ?? ""} /><input type="hidden" name="tenantCode" value={tenantCode ?? ""} />
          <button className={`notif-item${n.readAt ? "" : " unread"}`} style={{ width: "100%", textAlign: "left", background: n.readAt ? "#fff" : undefined, borderRadius: 0 }}>
            <div className="notif-title">{n.title}</div>
            {n.body && <div className="notif-body" style={{ whiteSpace: "pre-line" }}>{n.body}</div>}
            <div className="notif-meta">{tenantName && <span className="badge badge-muted">{tenantName}</span>}<span>{fmtDateTime(n.createdAt)}</span></div>
          </button>
        </form>
      ))}
    </div>
  );
}
