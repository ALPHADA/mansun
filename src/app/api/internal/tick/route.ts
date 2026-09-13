import { tick } from "@/scheduler/tick";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
/** dev/운영자용 수동 tick — 프로덕션에서는 내부 토큰 또는 운영자 세션 필요 */
export async function POST(req: Request) {
  const token = req.headers.get("x-internal-token");
  const session = await getSession();
  const allowed = process.env.NODE_ENV !== "production" || (process.env.INTERNAL_TOKEN && token === process.env.INTERNAL_TOKEN) || session?.isPlatformAdmin || session?.tenantRoles?.some((r) => r === "operator" || r === "admin");
  if (!allowed) return new Response("forbidden", { status: 403 });
  const r = await tick();
  return Response.json(r);
}
