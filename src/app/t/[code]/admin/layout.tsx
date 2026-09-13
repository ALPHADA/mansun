import { notFound } from "next/navigation";
import { SidebarShell, type NavItem } from "@/components/SidebarShell";
import { tenantChrome } from "@/components/TenantChrome";
import { fmtDateTime } from "@/lib/format";

export default async function AdminLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  const { ctx, switcher, banner, bell, userLine } = await tenantChrome(code);
  if (!ctx.roles.includes("admin") && !(ctx.isPlatformAdmin && !ctx.role) && !ctx.roles.includes("operator")) notFound();
  const base = `/t/${code}/admin`;
  const nav: NavItem[] = [
    { href: base, icon: "🏠", label: "관리 홈", exact: true },
    { href: `${base}/settings`, icon: "⚙️", label: "수협 설정" },
    { href: `${base}/members`, icon: "👥", label: "멤버 관리" },
    { href: `${base}/brokers`, icon: "🪪", label: "중매인 면허" },
    { href: `${base}/shippers`, icon: "🚢", label: "선주 등록" },
    { href: `${base}/audit-logs`, icon: "🧾", label: "감사 로그" },
    { href: `${base}/stats`, icon: "📈", label: "통계/리포트" },
    { href: `/t/${code}/operator/dashboard`, icon: "🔨", label: "운영 화면" },
  ];
  return (
    <SidebarShell brandTag="ADMIN" nav={nav} userLine={userLine} tenantSlot={switcher()} homeHref={base} banner={banner}
      title={ctx.tenant.name} meta={<span className="flex">{fmtDateTime(new Date())} {bell()}</span>}>
      {children}
    </SidebarShell>
  );
}
