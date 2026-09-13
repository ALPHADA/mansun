import { requirePlatformAdmin } from "@/lib/auth/context";
import { listMemberships } from "@/services/auth";
import { SidebarShell } from "@/components/SidebarShell";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { fmtDateTime } from "@/lib/format";
import "@/styles/admin-pages.css";
import "@/styles/platform-pages.css";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin();
  const memberships = await listMemberships(session.userId);
  return (
    <SidebarShell brandTag="PLATFORM" homeHref="/platform" userLine={`${session.name} / Platform Admin`}
      tenantSlot={<TenantSwitcher current={null} memberships={memberships} isPlatformAdmin />}
      nav={[
        { href: "/platform", icon: "🏠", label: "플랫폼 대시보드", exact: true },
        { href: "/platform/tenants", icon: "🏢", label: "수협(Tenant)" },
        { href: "/platform/users", icon: "👥", label: "글로벌 사용자" },
        { href: "/platform/stats", icon: "📈", label: "플랫폼 통계" },
        { href: "/platform/audit-logs", icon: "🧾", label: "감사 로그" },
      ]}
      title="MANSUN Platform Console" meta={fmtDateTime(new Date())}>
      {children}
    </SidebarShell>
  );
}
