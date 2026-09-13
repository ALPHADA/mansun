import "server-only";
import { and, eq, or, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { users, memberships, tenants, platformAdmins, invitations, otpCodes, type Role } from "@/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { setSessionCookie, type SessionPayload } from "@/lib/auth/session";
import { ROLE_PRIORITY } from "@/lib/authz/matrix";
import { audit } from "./audit";
import { AppError } from "@/lib/errors";
import { notify } from "./notification";

export interface MembershipSummary {
  tenantId: string; tenantCode: string; tenantName: string; tenantStatus: string; roles: Role[];
}

export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await db.select({
    tenantId: tenants.id, tenantCode: tenants.code, tenantName: tenants.name, tenantStatus: tenants.status, role: memberships.role,
  }).from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
  const map = new Map<string, MembershipSummary>();
  for (const r of rows) {
    const m = map.get(r.tenantId) ?? { tenantId: r.tenantId, tenantCode: r.tenantCode, tenantName: r.tenantName, tenantStatus: r.tenantStatus, roles: [] };
    m.roles.push(r.role);
    map.set(r.tenantId, m);
  }
  for (const m of map.values()) m.roles.sort((a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b));
  return [...map.values()];
}

export async function isPlatformAdmin(userId: string) {
  const [pa] = await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1);
  return !!pa;
}

/** 로그인. 반환: 세션 + 다음 이동 경로 */
export async function login(identifier: string, password: string): Promise<{ next: string }> {
  const id = identifier.trim();
  const [u] = await db.select().from(users).where(or(eq(users.email, id), eq(users.phone, id.replace(/-/g, "")))).limit(1);
  const ok = u && (await verifyPassword(password, u.passwordHash));
  if (!u || !ok) {
    await audit({ action: "auth.login_failed", after: { identifier: id } });
    throw new AppError("unauthorized", "이메일/전화번호 또는 비밀번호가 올바르지 않습니다");
  }
  if (u.globalSuspended) throw new AppError("forbidden", "정지된 계정입니다. 운영팀에 문의하세요");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));

  const pa = await isPlatformAdmin(u.id);
  const ms = await listMemberships(u.id);
  if (!pa && ms.length === 0) throw new AppError("forbidden", "소속된 수협이 없습니다. 초청을 받은 후 이용하세요");

  const base: SessionPayload = { userId: u.id, name: u.name, isPlatformAdmin: pa, activeTenantId: null, activeTenantCode: null, activeRole: null, tenantRoles: [] };
  await audit({ action: "auth.login", actorUserId: u.id });

  if (!pa && ms.length === 1) {
    const m = ms[0];
    await setSessionCookie({ ...base, activeTenantId: m.tenantId, activeTenantCode: m.tenantCode, activeRole: m.roles[0], tenantRoles: m.roles });
    return { next: `/t/${m.tenantCode}` };
  }
  await setSessionCookie(base);
  return { next: "/select-tenant" };
}

export async function selectTenant(session: SessionPayload, tenantCode: string | "platform"): Promise<{ next: string }> {
  if (tenantCode === "platform") {
    if (!session.isPlatformAdmin) throw new AppError("forbidden", "권한이 없습니다");
    await setSessionCookie({ ...session, activeTenantId: null, activeTenantCode: null, activeRole: null, tenantRoles: [] });
    return { next: "/platform" };
  }
  const ms = await listMemberships(session.userId);
  const m = ms.find((x) => x.tenantCode === tenantCode);
  if (m) {
    await setSessionCookie({ ...session, activeTenantId: m.tenantId, activeTenantCode: m.tenantCode, activeRole: m.roles[0], tenantRoles: m.roles, readSessionId: null });
    await audit({ action: "auth.select_tenant", actorUserId: session.userId, tenantId: m.tenantId });
    return { next: `/t/${m.tenantCode}` };
  }
  if (session.isPlatformAdmin) {
    const [t] = await db.select().from(tenants).where(eq(tenants.code, tenantCode)).limit(1);
    if (!t) throw new AppError("not_found", "수협을 찾을 수 없습니다");
    // 비소속 Platform Admin 의 Tenant 진입은 분쟁 조회 모드(사유 입력)를 통해서만 — 상세 페이지로 안내
    await audit({ action: "platform.enter_tenant", actorUserId: session.userId, tenantId: t.id });
    return { next: `/platform/tenants/${t.code}?readmode=required` };
  }
  throw new AppError("forbidden", "소속되지 않은 수협입니다");
}

// ───────── 초청 ─────────
export async function getInvitation(token: string) {
  const [inv] = await db.select({ inv: invitations, tenantName: tenants.name, tenantCode: tenants.code })
    .from(invitations).innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))).limit(1);
  return inv ?? null;
}

export async function issueOtp(target: string, purpose: string, userId?: string | null) {
  const code = process.env.NODE_ENV === "production" ? String(Math.floor(100000 + Math.random() * 900000)) : "000000";
  await db.insert(otpCodes).values({ userId: userId ?? null, target, purpose, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  if (userId) {
    await notify({ tenantId: null, userIds: [userId], type: "otp", title: "MANSUN 인증번호", body: `인증번호 [${code}] (5분 유효)`, channels: ["sms"], mandatory: true });
  }
  return process.env.SHOW_DEV_OTP === "true" ? code : null;
}

export async function verifyOtp(target: string, purpose: string, code: string) {
  const [row] = await db.select().from(otpCodes)
    .where(and(eq(otpCodes.target, target), eq(otpCodes.purpose, purpose), eq(otpCodes.code, code), isNull(otpCodes.usedAt), gt(otpCodes.expiresAt, new Date())))
    .limit(1);
  if (!row) return false;
  await db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, row.id));
  return true;
}

export async function acceptInvitation(token: string, input: { password: string; phone?: string; otp: string }) {
  const found = await getInvitation(token);
  if (!found) throw new AppError("not_found", "유효하지 않거나 만료된 초청입니다");
  const inv = found.inv;
  const phone = (input.phone ?? inv.phone ?? "").replace(/-/g, "");
  const okOtp = await verifyOtp(inv.email, "invite", input.otp);
  if (!okOtp) throw new AppError("validation", "인증번호가 올바르지 않습니다");

  return db.transaction(async (tx) => {
    let [u] = await tx.select().from(users).where(eq(users.email, inv.email)).limit(1);
    if (!u) {
      [u] = await tx.insert(users).values({
        email: inv.email, phone: phone || null, name: inv.name, passwordHash: await hashPassword(input.password), identityVerified: true,
      }).returning();
    } else {
      await tx.update(users).set({ identityVerified: true, passwordHash: u.passwordHash ?? (await hashPassword(input.password)) }).where(eq(users.id, u.id));
    }
    const existing = await tx.select().from(memberships)
      .where(and(eq(memberships.userId, u.id), eq(memberships.tenantId, inv.tenantId), eq(memberships.role, inv.role))).limit(1);
    if (existing.length) {
      await tx.update(memberships).set({ status: "active", joinedAt: new Date(), licenseNo: inv.licenseNo ?? existing[0].licenseNo }).where(eq(memberships.id, existing[0].id));
    } else {
      await tx.insert(memberships).values({
        userId: u.id, tenantId: inv.tenantId, role: inv.role, licenseNo: inv.licenseNo, title: inv.title,
        licenseStatus: inv.role === "broker" ? "active" : null, status: "active", invitedBy: inv.invitedBy, joinedAt: new Date(),
      });
    }
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await audit({ tenantId: inv.tenantId, actorUserId: u.id, action: "membership.accept_invite", targetType: "invitation", targetId: inv.id, after: { role: inv.role } }, tx);
    return { userId: u.id, tenantCode: found.tenantCode };
  });
}
