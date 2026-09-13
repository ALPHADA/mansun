import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { selectTenant } from "@/services/auth";

/** 활성 Tenant 전환 (쿠키 갱신은 Route Handler에서만 가능) — GET /api/auth/switch?code=gangu&next=/t/gangu/... */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const next = url.searchParams.get("next") ?? "";
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next || "/")}`);
  try {
    const r = await selectTenant(session, code);
    const target = next.startsWith(`/t/${code}`) || (code === "platform" && next.startsWith("/platform")) ? next : r.next;
    redirect(target);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect
    redirect("/select-tenant");
  }
}
