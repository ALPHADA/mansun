import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listMemberships } from "@/services/auth";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { TENANT_STATUS } from "@/domain/status";
import { Badge } from "@/components/Badge";
import { selectTenantFormAction, logoutAction } from "../actions";

export const metadata = { title: "수협 선택" };

export default async function SelectTenantPage({ searchParams }: { searchParams: Promise<{ switch?: string; next?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await listMemberships(session.userId);

  // 자동 전환 요청 (URL code 불일치 시)
  if (sp.switch && (ms.some((m) => m.tenantCode === sp.switch) || session.isPlatformAdmin)) {
    const fd = new FormData(); fd.set("code", sp.switch); fd.set("next", sp.next ?? "");
    await selectTenantFormAction(fd);
  }
  if (!session.isPlatformAdmin && ms.length === 1) {
    const fd = new FormData(); fd.set("code", ms[0].tenantCode);
    await selectTenantFormAction(fd);
  }

  return (
    <div className="auth-body">
      <div className="login-card wide">
        <div className="brand">
          <div className="logo">🐟</div>
          <h1>어느 수협에서 작업할까요?</h1>
          <p>{session.name} 님은 {ms.length}개 수협에 소속되어 있습니다</p>
        </div>
        <div className="tenant-grid">
          {session.isPlatformAdmin && (
            <form action={selectTenantFormAction}>
              <input type="hidden" name="code" value="platform" />
              <button className={`tenant-card platform${!session.activeTenantId ? " active" : ""}`}>
                <div className="tenant-name">🛠 Platform Console</div>
                <div className="tenant-roles" style={{ color: "#94a3b8" }}>MANSUN 플랫폼 운영</div>
              </button>
            </form>
          )}
          {ms.map((m) => (
            <form key={m.tenantId} action={selectTenantFormAction}>
              <input type="hidden" name="code" value={m.tenantCode} />
              <button className={`tenant-card${session.activeTenantCode === m.tenantCode ? " active" : ""}`}>
                <div className="flex space-between">
                  <div className="tenant-name">{m.tenantName}</div>
                  {m.tenantStatus !== "active" && <Badge tone={TENANT_STATUS[m.tenantStatus as keyof typeof TENANT_STATUS].badge}>{TENANT_STATUS[m.tenantStatus as keyof typeof TENANT_STATUS].label}</Badge>}
                </div>
                <div className="tenant-roles">{m.roles.map((r) => ROLE_LABEL[r]).join(" · ")}</div>
              </button>
            </form>
          ))}
        </div>
        <div className="mt-16 text-right">
          <form action={logoutAction}><button className="btn-ghost">로그아웃</button></form>
        </div>
      </div>
    </div>
  );
}
