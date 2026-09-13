import { notFound } from "next/navigation";
import { MobileShell } from "@/components/MobileShell";
import { tenantChrome } from "@/components/TenantChrome";
import "@/styles/mobile-pages.css";

export default async function BrokerLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  const { ctx, switcher, banner, bell } = await tenantChrome(code);
  if (!ctx.roles.includes("broker")) notFound();
  const base = `/t/${code}/broker`;
  return (
    <MobileShell title={switcher(true)} banner={banner} right={bell()} tabs={[
      { href: `${base}/auctions`, icon: "🐟", label: "경매" },
      { href: `${base}/results`, icon: "🔨", label: "내 입찰" },
      { href: `${base}/settlement`, icon: "💰", label: "정산" },
      { href: `${base}/my`, icon: "👤", label: "마이" },
    ]}>
      {children}
    </MobileShell>
  );
}
