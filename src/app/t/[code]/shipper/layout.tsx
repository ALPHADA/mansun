import { notFound } from "next/navigation";
import { MobileShell } from "@/components/MobileShell";
import { tenantChrome } from "@/components/TenantChrome";
import "@/styles/mobile-pages.css";
import "@/styles/shipper-union.css";

export default async function ShipperLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  const { ctx, switcher, banner, bell } = await tenantChrome(code);
  if (!ctx.roles.includes("shipper")) notFound();
  const base = `/t/${code}/shipper`;
  return (
    <MobileShell title={switcher(true)} banner={banner} right={bell()} tabs={[
      { href: base, icon: "🚢", label: "출하", exact: true },
      { href: `${base}/vessels`, icon: "⚓", label: "선박" },
      { href: `${base}/settlement`, icon: "💰", label: "정산" },
      { href: `${base}/my`, icon: "👤", label: "마이" },
    ]}>
      {children}
    </MobileShell>
  );
}
