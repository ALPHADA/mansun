import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.activeTenantCode) redirect(`/t/${s.activeTenantCode}`);
  if (s.isPlatformAdmin) redirect("/platform");
  redirect("/select-tenant");
}
