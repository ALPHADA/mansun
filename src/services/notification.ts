import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { memberships, notifications, users, type NotificationChannel, type NotificationType, type Role, type NotificationPrefs } from "@/db/schema";
import { smsAdapter, kakaoAdapter, emailAdapter } from "@/adapters/notification/mock";

export interface NotifyInput {
  tenantId: string | null;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** 외부 채널 (인앱은 항상) */
  channels?: NotificationChannel[];
  /** 옵트아웃 불가 (낙찰 등) */
  mandatory?: boolean;
}

const adapters = { sms: smsAdapter, kakao: kakaoAdapter, email: emailAdapter };

/** 인앱 알림 + 외부 채널(Mock) 발송. 반환: 성공/실패 건수 */
export async function notify(input: NotifyInput, tx: DbOrTx = db) {
  const ids = [...new Set(input.userIds)];
  if (ids.length === 0) return { success: 0, fail: 0 };
  const rows = await tx.select({ id: users.id, phone: users.phone, email: users.email }).from(users).where(inArray(users.id, ids));

  // 사용자별 알림 설정 (활성 Tenant Membership 기준)
  let prefsByUser = new Map<string, NotificationPrefs>();
  if (input.tenantId) {
    const ms = await tx.select({ userId: memberships.userId, prefs: memberships.notificationPrefs })
      .from(memberships).where(and(eq(memberships.tenantId, input.tenantId), inArray(memberships.userId, ids)));
    prefsByUser = new Map(ms.map((m) => [m.userId, m.prefs]));
  }

  let success = 0, fail = 0;
  const inappRows = rows
    .filter((u) => {
      if (input.mandatory) return true;
      const prefs = prefsByUser.get(u.id);
      if (input.type === "lost") return prefs?.lostBidInapp ?? true;
      return prefs?.inapp ?? true;
    })
    .map((u) => ({ userId: u.id, tenantId: input.tenantId, type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null }));
  if (inappRows.length) await tx.insert(notifications).values(inappRows);
  success += inappRows.length;

  for (const ch of input.channels ?? []) {
    if (ch === "inapp") continue;
    const adapter = adapters[ch];
    if (!adapter) continue;
    for (const u of rows) {
      const prefs = prefsByUser.get(u.id);
      if (!input.mandatory && prefs && prefs[ch] === false) continue;
      const recipient = ch === "email" ? u.email : u.phone;
      if (!recipient) { fail++; continue; }
      const r = await adapter.send({ tenantId: input.tenantId, userId: u.id, recipient, subject: input.title, body: input.body ?? input.title, meta: { type: input.type, link: input.link } });
      if (r.ok) success++; else fail++;
    }
  }
  return { success, fail };
}

/** Tenant 내 역할별 활성 사용자 id */
export async function usersByRoles(tenantId: string, roles: Role[], tx: DbOrTx = db) {
  if (roles.length === 0) return [];
  const rows = await tx.select({ userId: memberships.userId }).from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), inArray(memberships.role, roles)));
  return [...new Set(rows.map((r) => r.userId))];
}

// ───────── 알림함 ─────────
export async function listNotifications(userId: string, opts: { tenantId?: string | null; unreadOnly?: boolean; limit?: number } = {}) {
  const { tenants } = await import("@/db/schema");
  const { desc, isNull } = await import("drizzle-orm");
  const conds = [eq(notifications.userId, userId)];
  if (opts.tenantId) conds.push(eq(notifications.tenantId, opts.tenantId));
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  return db.select({ n: notifications, tenantName: tenants.name, tenantCode: tenants.code }).from(notifications).leftJoin(tenants, eq(tenants.id, notifications.tenantId))
    .where(and(...conds)).orderBy(desc(notifications.createdAt)).limit(opts.limit ?? 100);
}
export async function markRead(userId: string, ids: string[] | "all") {
  const { isNull } = await import("drizzle-orm");
  if (ids === "all") await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  else if (ids.length) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
}
export async function unreadCount(userId: string) {
  const { isNull, count } = await import("drizzle-orm");
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return n;
}
