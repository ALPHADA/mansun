import { notFound } from "next/navigation";
import { MobileShell } from "@/components/MobileShell";
import { tenantChrome } from "@/components/TenantChrome";
import "@/styles/mobile-pages.css";

export default async function ReceiverLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  const { ctx, switcher, banner, bell } = await tenantChrome(code);
  if (!ctx.roles.some((r) => r === "receiver" || r === "operator" || r === "admin") && !(ctx.isPlatformAdmin && !ctx.role)) notFound();
  const base = `/t/${code}/receiver`;
  return (
    <MobileShell title={switcher(true)} banner={banner} right={bell()} tabs={[
      { href: base, icon: "📥", label: "입고", exact: true },
      { href: `${base}/new`, icon: "➕", label: "신규 입고" },
      { href: `${base}/offline-queue`, icon: "📶", label: "대기열" },
      { href: `/t/${code}/operator/dashboard`, icon: "🖥", label: "운영" },
    ]}>
      {children}
    </MobileShell>
  );
}
