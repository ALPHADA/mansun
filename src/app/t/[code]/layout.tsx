import { requireTenantContext } from "@/lib/auth/context";
import { ServerClockProvider } from "@/components/ServerClock";

export default async function TenantLayout({ params, children }: { params: Promise<{ code: string }>; children: React.ReactNode }) {
  const { code } = await params;
  await requireTenantContext(code);
  return <ServerClockProvider>{children}</ServerClockProvider>;
}
