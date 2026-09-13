import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { setSessionCookie, type SessionPayload } from "@/lib/auth/session";
import { isPlatformAdmin, listMemberships } from "@/services/auth";

/** 개발 전용: 비밀번호 없이 세션 발급. GET /api/dev/login?email=operator@gangu.kr&tenant=gangu&role=operator */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const tenantCode = url.searchParams.get("tenant");
  const role = url.searchParams.get("role");
  if (!email) return new Response("email required", { status: 400 });
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) return new Response("no user", { status: 404 });
  const pa = await isPlatformAdmin(u.id);
  const ms = await listMemberships(u.id);
  const m = tenantCode ? ms.find((x) => x.tenantCode === tenantCode) : ms.length === 1 ? ms[0] : null;
  const payload: SessionPayload = {
    userId: u.id, name: u.name, isPlatformAdmin: pa,
    activeTenantId: m?.tenantId ?? null, activeTenantCode: m?.tenantCode ?? null,
    activeRole: m ? ((role && m.roles.includes(role as never) ? role : m.roles[0]) as SessionPayload["activeRole"]) : null,
    tenantRoles: m?.roles ?? [],
  };
  await setSessionCookie(payload);
  const next = url.searchParams.get("next");
  redirect(next ?? (m ? `/t/${m.tenantCode}` : pa ? "/platform" : "/select-tenant"));
}
