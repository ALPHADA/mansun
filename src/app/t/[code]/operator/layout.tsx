import { notFound } from "next/navigation";
import { SidebarShell, type NavItem } from "@/components/SidebarShell";
import { tenantChrome } from "@/components/TenantChrome";
import { fmtDateTime } from "@/lib/format";
import "@/styles/operator-pages.css";

export default async function OperatorLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  const { ctx, switcher, banner, bell, userLine } = await tenantChrome(code);
  const isOps = ctx.roles.some((r) => r === "admin" || r === "operator");
  const isRecv = ctx.roles.includes("receiver");
  if (!isOps && !isRecv && !(ctx.isPlatformAdmin && !ctx.role)) notFound();
  const base = `/t/${code}/operator`;
  const nav: NavItem[] = isOps || ctx.isPlatformAdmin ? [
    { href: `${base}/dashboard`, icon: "📊", label: "대시보드" },
    { href: `${base}/intake`, icon: "📥", label: "입고 등록" },
    { href: `${base}/notice`, icon: "📢", label: "경매 공지" },
    { href: `${base}/results`, icon: "🔨", label: "개찰 · 결과" },
    { href: `${base}/bids`, icon: "📋", label: "입찰 내역" },
    { href: `${base}/settlement`, icon: "💰", label: "정산" },
  ] : [{ href: `${base}/intake`, icon: "📥", label: "입고 등록" }];
  if (ctx.roles.includes("admin")) nav.push({ href: `/t/${code}/admin`, icon: "⚙️", label: "수협 관리" });
  if (isRecv) nav.push({ href: `/t/${code}/receiver`, icon: "📱", label: "현장 입고(모바일)" });
  return (
    <SidebarShell brandTag="OPS" nav={nav} userLine={userLine} tenantSlot={switcher()} homeHref={`${base}/dashboard`} banner={banner}
      title={<span id="page-title">{ctx.tenant.name}</span>} meta={<span className="flex">{fmtDateTime(new Date())} {bell()}</span>}>
      {children}
    </SidebarShell>
  );
}
