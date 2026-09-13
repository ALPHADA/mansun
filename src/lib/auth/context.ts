import "server-only";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { notFound as nextNotFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { tenants, memberships, type Role, type Tenant } from "@/db/schema";
import { getSession, type SessionPayload } from "./session";
import { roleHas, type Permission } from "@/lib/authz/matrix";
import { forbidden, AppError } from "@/lib/errors";

export interface TenantContext {
  session: SessionPayload;
  tenant: Tenant;
  role: Role | null;              // active role (Platform Admin 읽기 모드면 null)
  roles: Role[];
  membershipId: string | null;
  readOnly: boolean;              // Platform Admin 조회 모드 또는 suspended/archived
  isPlatformAdmin: boolean;
}

export const getTenantByCode = cache(async (code: string) => {
  const [t] = await db.select().from(tenants).where(eq(tenants.code, code)).limit(1);
  return t ?? null;
});

/** 페이지/레이아웃용: 세션 없으면 로그인으로, 소속 없으면 404 */
export const requireTenantContext = cache(async (code: string): Promise<TenantContext> => {
  const session = await getSession();
  if (!session) redirect(`/login?next=/t/${code}`);
  const tenant = await getTenantByCode(code);
  if (!tenant) nextNotFound();

  if (session.activeTenantId !== tenant.id) {
    // URL code 와 토큰 불일치 → 소속이면 전환 유도, 아니면 404
    const ms = await db.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenant.id), eq(memberships.status, "active"))).limit(1);
    if (ms.length || session.isPlatformAdmin) redirect(`/select-tenant?switch=${tenant.code}&next=/t/${code}`);
    nextNotFound();
  }

  const isPA = session.isPlatformAdmin && !session.activeRole;
  let membershipId: string | null = null;
  if (session.activeRole) {
    const [m] = await db.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenant.id), eq(memberships.role, session.activeRole), eq(memberships.status, "active"))).limit(1);
    if (!m) redirect(`/select-tenant?next=/t/${code}`);
    membershipId = m.id;
  }
  const readOnly = isPA || tenant.status !== "active";
  return { session, tenant, role: session.activeRole, roles: session.tenantRoles ?? [], membershipId, readOnly, isPlatformAdmin: session.isPlatformAdmin };
});

/** 서버 액션용 권한 가드 — 쓰기 권한은 readOnly 컨텍스트에서 항상 거부 */
export async function requirePermission(code: string, permission: Permission, opts: { write?: boolean } = { write: true }): Promise<TenantContext> {
  const ctx = await requireTenantContext(code);
  if (ctx.isPlatformAdmin && !ctx.role) {
    if (opts.write !== false) throw forbidden("Platform Admin은 읽기 전용입니다");
    return ctx;
  }
  if (!ctx.roles.some((r) => roleHas(r, permission))) throw forbidden();
  if (opts.write !== false && ctx.tenant.status !== "active") throw new AppError("state", "이 수협은 현재 운영 상태가 아니어서 변경할 수 없습니다");
  return ctx;
}

export function hasPermission(ctx: TenantContext, permission: Permission) {
  if (ctx.isPlatformAdmin && !ctx.role) return true; // 읽기 관점
  return ctx.roles.some((r) => roleHas(r, permission));
}

export async function requirePlatformAdmin() {
  const session = await getSession();
  if (!session) redirect("/login?next=/platform");
  if (!session.isPlatformAdmin) nextNotFound();
  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
