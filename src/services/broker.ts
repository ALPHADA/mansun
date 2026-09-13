import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, tenants, users, type NotificationPrefs } from "@/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { forbidden, validation } from "@/lib/errors";
import { audit } from "./audit";
import type { TenantContext } from "@/lib/auth/context";

/** 마이페이지 프로필 (이름·전화·이메일) */
export async function getProfile(userId: string) {
  const [u] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email, identityVerified: users.identityVerified, lastLoginAt: users.lastLoginAt })
    .from(users).where(eq(users.id, userId)).limit(1);
  return u ?? null;
}

/** 모든 Tenant 의 중매인 면허 (다중 소속) */
export async function listMyBrokerLicenses(userId: string) {
  return db.select({
    membershipId: memberships.id, tenantId: tenants.id, tenantCode: tenants.code, tenantName: tenants.name, tenantStatus: tenants.status,
    licenseNo: memberships.licenseNo, licenseStatus: memberships.licenseStatus, licenseExpiresAt: memberships.licenseExpiresAt, status: memberships.status, joinedAt: memberships.joinedAt,
  }).from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "broker"))).orderBy(asc(tenants.name));
}

/** 활성 멤버십의 알림 설정 */
export async function getNotificationPrefs(membershipId: string): Promise<NotificationPrefs | null> {
  const [m] = await db.select({ prefs: memberships.notificationPrefs }).from(memberships).where(eq(memberships.id, membershipId)).limit(1);
  return m?.prefs ?? null;
}

export async function updateNotificationPrefs(ctx: TenantContext, prefs: NotificationPrefs) {
  if (!ctx.membershipId) throw forbidden("활성 멤버십이 없습니다");
  const [before] = await db.select({ prefs: memberships.notificationPrefs, userId: memberships.userId }).from(memberships).where(eq(memberships.id, ctx.membershipId)).limit(1);
  if (!before || before.userId !== ctx.session.userId) throw forbidden();
  const next: NotificationPrefs = { inapp: !!prefs.inapp, kakao: !!prefs.kakao, sms: !!prefs.sms, email: !!prefs.email, lostBidInapp: !!prefs.lostBidInapp };
  await db.update(memberships).set({ notificationPrefs: next }).where(eq(memberships.id, ctx.membershipId));
  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "membership.notification_prefs", targetType: "membership", targetId: ctx.membershipId, before: before.prefs, after: next });
  return next;
}

export async function changePassword(userId: string, current: string, next: string) {
  if (next.length < 8) throw validation("새 비밀번호는 8자 이상이어야 합니다");
  if (current === next) throw validation("현재 비밀번호와 다른 비밀번호를 입력하세요");
  const [u] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw forbidden();
  if (!(await verifyPassword(current, u.passwordHash))) throw validation("현재 비밀번호가 올바르지 않습니다");
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await audit({ actorUserId: userId, action: "auth.change_password", targetType: "user", targetId: userId });
}
