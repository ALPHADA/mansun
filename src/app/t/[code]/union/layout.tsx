import { notFound } from "next/navigation";
import { MobileShell } from "@/components/MobileShell";
import { tenantChrome } from "@/components/TenantChrome";
import "@/styles/mobile-pages.css";
import "@/styles/shipper-union.css";

export default async function UnionLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  const { ctx, switcher, banner, bell } = await tenantChrome(code);
  if (!ctx.roles.includes("union") && !(ctx.isPlatformAdmin && !ctx.role)) notFound();
  const base = `/t/${code}/union`;
  return (
    <MobileShell title={switcher(true)} banner={banner} right={bell()} tabs={[
      { href: base, icon: "📅", label: "오늘", exact: true },
      { href: `${base}/schedule`, icon: "🗓", label: "일정" },
      { href: `${base}/stats`, icon: "📈", label: "작업량" },
    ]}>
      {children}
    </MobileShell>
  );
}
