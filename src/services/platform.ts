import "server-only";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { withPlatform } from "@/db/context";
import {
  tenants, users, memberships, invitations, auditLogs, platformAdmins, auctions, bids, rounds, platformReadSessions,
  type Tenant, type TenantStatus, type Role, type MembershipStatus, type FeePolicy, type ScheduleSlot,
} from "@/db/schema";
import { emailAdapter } from "@/adapters/notification/mock";
import { audit } from "./audit";
import { notify, usersByRoles } from "./notification";
import { conflict, notFound, stateError, validation } from "@/lib/errors";
import { localDateStr } from "@/lib/format";

/** Platform Admin 행위자 (세션에서 추출) */
export interface PlatformActor { userId: string; name?: string }
const ACTOR_ROLE = "platform_admin";

const kstDayStart = (dateStr: string) => new Date(`${dateStr}T00:00:00+09:00`);
const kstDayEnd = (dateStr: string) => new Date(kstDayStart(dateStr).getTime() + 86_400_000);

export const DEFAULT_FEE_POLICY: FeePolicy = { marketFeeRate: 0.04, brokerFeeRate: 0.015, vatIncluded: true, vatRate: 0.1 };
export const DEFAULT_SCHEDULE: ScheduleSlot[] = [{ seq: 1, label: "오전 1회차", bidStart: "06:30", bidClose: "07:00", autoNoticeAt: "05:00" }];

// ───────── KPI ─────────
export interface PlatformKpis {
  tenantsByStatus: Record<TenantStatus, number>;
  tenantsTotal: number;
  usersTotal: number;
  membershipsByRole: Record<Role, number>;
  today: { lots: number; bids: number; awardedAmount: number };
  recentTenants7d: number;
  recentTenants30d: number;
}

export async function platformKpis(): Promise<PlatformKpis> {
  const today = localDateStr();
  const [byStatus, [{ usersTotal }], byRole, todayLots, todayBids, recent7, recent30] = await Promise.all([
    db.select({ status: tenants.status, n: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.status),
    db.select({ usersTotal: sql<number>`count(*)::int` }).from(users),
    db.select({ role: memberships.role, n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.status, "active")).groupBy(memberships.role),
    withPlatform((tx) => tx.select({
      lots: sql<number>`count(*)::int`,
      awarded: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.finalPrice} * ${auctions.quantity} else 0 end), 0)::float`,
    }).from(auctions).innerJoin(rounds, eq(rounds.id, auctions.roundId)).where(and(eq(rounds.date, today), ne(auctions.status, "withdrawn")))),
    withPlatform((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(bids).where(and(gte(bids.submittedAt, kstDayStart(today)), lte(bids.submittedAt, kstDayEnd(today))))),
    db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(gte(tenants.createdAt, new Date(Date.now() - 7 * 86_400_000))),
    db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(gte(tenants.createdAt, new Date(Date.now() - 30 * 86_400_000))),
  ]);
  const tenantsByStatus: Record<TenantStatus, number> = { pending: 0, active: 0, suspended: 0, archived: 0 };
  for (const r of byStatus) tenantsByStatus[r.status] = r.n;
  const membershipsByRole: Record<Role, number> = { admin: 0, operator: 0, receiver: 0, broker: 0, shipper: 0, union: 0 };
  for (const r of byRole) membershipsByRole[r.role] = r.n;
  return {
    tenantsByStatus, tenantsTotal: byStatus.reduce((s, r) => s + r.n, 0), usersTotal, membershipsByRole,
    today: { lots: todayLots[0]?.lots ?? 0, bids: todayBids[0]?.n ?? 0, awardedAmount: Math.round(todayLots[0]?.awarded ?? 0) },
    recentTenants7d: recent7[0]?.n ?? 0, recentTenants30d: recent30[0]?.n ?? 0,
  };
}

// ───────── Tenant 목록/상세 ─────────
export async function listTenants(opts: { status?: TenantStatus; q?: string } = {}) {
  const conds = [];
  if (opts.status) conds.push(eq(tenants.status, opts.status));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    conds.push(or(ilike(tenants.code, q), ilike(tenants.name, q), ilike(tenants.region, q)));
  }
  const memberCount = sql<number>`(select count(*)::int from ${memberships} m where m.tenant_id = ${tenants.id} and m.status = 'active')`;
  const rows = await db.select({ tenant: tenants, memberCount }).from(tenants).where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`case ${tenants.status} when 'active' then 0 when 'pending' then 1 when 'suspended' then 2 else 3 end`, asc(tenants.name));
  const today = localDateStr();
  const lotRows = await withPlatform((tx) => tx.select({ tenantId: auctions.tenantId, n: sql<number>`count(*)::int` }).from(auctions)
    .innerJoin(rounds, eq(rounds.id, auctions.roundId)).where(and(eq(rounds.date, today), ne(auctions.status, "withdrawn"))).groupBy(auctions.tenantId));
  const lotsByTenant = new Map(lotRows.map((r) => [r.tenantId, r.n]));
  return rows.map((r) => ({ ...r.tenant, memberCount: r.memberCount, todayLots: lotsByTenant.get(r.tenant.id) ?? 0 }));
}
export type TenantListRow = Awaited<ReturnType<typeof listTenants>>[number];

export async function getTenantByCodeOrThrow(code: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.code, code)).limit(1);
  if (!t) throw notFound("수협을 찾을 수 없습니다");
  return t;
}

export async function getTenantDetail(code: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.code, code)).limit(1);
  if (!tenant) return null;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const sinceDate = localDateStr(since);
  const [roleRows, admins, pendingInvites, activity, daily, recentAudit] = await Promise.all([
    db.select({ role: memberships.role, status: memberships.status, n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.tenantId, tenant.id)).groupBy(memberships.role, memberships.status),
    db.select({ membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, phone: users.phone, title: memberships.title, status: memberships.status, joinedAt: memberships.joinedAt, lastLoginAt: users.lastLoginAt })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenant.id), eq(memberships.role, "admin"))).orderBy(asc(users.name)),
    db.select().from(invitations).where(and(eq(invitations.tenantId, tenant.id), eq(invitations.role, "admin"), sql`${invitations.acceptedAt} is null`)).orderBy(desc(invitations.createdAt)),
    withPlatform((tx) => tx.select({
      lots: sql<number>`count(*)::int`,
      awardedLots: sql<number>`count(*) filter (where ${auctions.status} in ('awarded','settled'))::int`,
      awardedAmount: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.finalPrice} * ${auctions.quantity} else 0 end), 0)::float`,
      rounds: sql<number>`count(distinct ${auctions.roundId})::int`,
    }).from(auctions).innerJoin(rounds, eq(rounds.id, auctions.roundId)).where(and(eq(auctions.tenantId, tenant.id), gte(rounds.date, sinceDate), ne(auctions.status, "withdrawn")))),
    withPlatform((tx) => tx.select({
      date: rounds.date, lots: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.finalPrice} * ${auctions.quantity} else 0 end), 0)::float`,
    }).from(auctions).innerJoin(rounds, eq(rounds.id, auctions.roundId)).where(and(eq(auctions.tenantId, tenant.id), gte(rounds.date, sinceDate), ne(auctions.status, "withdrawn"))).groupBy(rounds.date).orderBy(asc(rounds.date))),
    db.select({ log: auditLogs, actorName: users.name }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(eq(auditLogs.tenantId, tenant.id)).orderBy(desc(auditLogs.at)).limit(10),
  ]);
  const memberCounts: Record<Role, { active: number; invited: number; suspended: number }> = {
    admin: { active: 0, invited: 0, suspended: 0 }, operator: { active: 0, invited: 0, suspended: 0 }, receiver: { active: 0, invited: 0, suspended: 0 },
    broker: { active: 0, invited: 0, suspended: 0 }, shipper: { active: 0, invited: 0, suspended: 0 }, union: { active: 0, invited: 0, suspended: 0 },
  };
  for (const r of roleRows) memberCounts[r.role][r.status] = r.n;
  return {
    tenant, memberCounts, admins, pendingInvites,
    activity: { lots: activity[0]?.lots ?? 0, awardedLots: activity[0]?.awardedLots ?? 0, awardedAmount: Math.round(activity[0]?.awardedAmount ?? 0), rounds: activity[0]?.rounds ?? 0, daily: daily.map((d) => ({ ...d, amount: Math.round(d.amount) })) },
    recentAudit: recentAudit.map((r) => ({ ...r.log, actorName: r.actorName })),
  };
}
export type TenantDetail = NonNullable<Awaited<ReturnType<typeof getTenantDetail>>>;

// ───────── Tenant 등록 ─────────
export const tenantCreateSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9]{2,11}$/, "code는 영소문자로 시작하는 영소문자·숫자 3~12자"),
  name: z.string().trim().min(2, "이름은 2자 이상").max(40, "이름은 40자 이내"),
  region: z.string().trim().min(1, "지역(광역시·도)을 입력하세요"),
  businessNo: z.string().trim().transform((s) => s.replace(/-/g, "")).pipe(z.string().regex(/^\d{10}$/, "사업자등록번호는 숫자 10자리")),
  address: z.string().trim().min(1, "위판장 주소를 입력하세요"),
  contactEmail: z.email("연락 이메일 형식이 올바르지 않습니다"),
  contactPhone: z.string().trim().transform((s) => s.replace(/-/g, "")).pipe(z.string().regex(/^\d{9,11}$/, "연락 전화는 숫자 9~11자리")),
  adminName: z.string().trim().min(2, "초기 Admin 이름은 2자 이상"),
  adminEmail: z.email("초기 Admin 이메일 형식이 올바르지 않습니다"),
  adminPhone: z.string().trim().transform((s) => s.replace(/-/g, "")).pipe(z.string().regex(/^\d{10,11}$/, "전화번호는 숫자 10~11자리")).optional().or(z.literal("").transform(() => undefined)),
  adminTitle: z.string().trim().max(30).optional(),
});
export type TenantCreateInput = z.input<typeof tenantCreateSchema>;

export const adminInviteSchema = z.object({
  name: z.string().trim().min(2, "이름은 2자 이상"),
  email: z.email("이메일 형식이 올바르지 않습니다"),
  phone: z.string().trim().transform((s) => s.replace(/-/g, "")).pipe(z.string().regex(/^\d{10,11}$/, "전화번호는 숫자 10~11자리")).optional().or(z.literal("").transform(() => undefined)),
  title: z.string().trim().max(30).optional(),
});
export type AdminInviteInput = z.input<typeof adminInviteSchema>;

async function createAdminInvitation(actor: PlatformActor, tenant: Tenant, input: { name: string; email: string; phone?: string | null; title?: string | null }) {
  const token = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const [inv] = await db.insert(invitations).values({
    token, tenantId: tenant.id, role: "admin", name: input.name, email: input.email.toLowerCase(), phone: input.phone ?? null, title: input.title ?? null,
    invitedBy: actor.userId, expiresAt,
  }).returning();
  const inviteLink = `/invite/${token}`;
  await emailAdapter.send({
    tenantId: tenant.id, recipient: inv.email, subject: `[MANSUN] ${tenant.name} 관리자 초청`,
    body: `${input.name}님, ${tenant.name}의 초기 관리자(Admin)로 초청되었습니다. 아래 링크에서 7일 이내에 가입을 완료하세요.\n${inviteLink}`,
    meta: { type: "invite", link: inviteLink, invitationId: inv.id },
  });
  await audit({ tenantId: tenant.id, actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "membership.invite", targetType: "invitation", targetId: inv.id, after: { role: "admin", name: input.name, email: inv.email, expiresAt } });
  return { invitation: inv, inviteLink };
}

export async function createTenant(actor: PlatformActor, raw: TenantCreateInput) {
  const input = tenantCreateSchema.parse(raw);
  const [dup] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, input.code)).limit(1);
  if (dup) throw conflict("이미 사용 중인 code 입니다");
  const [tenant] = await db.insert(tenants).values({
    code: input.code, name: input.name, region: input.region, businessNo: input.businessNo, address: input.address,
    contactEmail: input.contactEmail.toLowerCase(), contactPhone: input.contactPhone, status: "pending",
    feePolicy: DEFAULT_FEE_POLICY, schedule: DEFAULT_SCHEDULE,
  }).returning();
  await audit({ tenantId: tenant.id, actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "tenant.create", targetType: "tenant", targetId: tenant.id, after: { code: tenant.code, name: tenant.name, region: tenant.region, status: tenant.status } });
  const { inviteLink } = await createAdminInvitation(actor, tenant, { name: input.adminName, email: input.adminEmail, phone: input.adminPhone ?? null, title: input.adminTitle ?? null });
  return { tenant, inviteLink };
}

/** 초기 Admin 재초청 (기존 미수락 초청은 만료 처리) */
export async function inviteInitialAdmin(actor: PlatformActor, tenantId: string, raw: AdminInviteInput) {
  const input = adminInviteSchema.parse(raw);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw notFound("수협을 찾을 수 없습니다");
  if (tenant.status === "archived") throw stateError("아카이브된 수협에는 초청할 수 없습니다");
  await db.update(invitations).set({ expiresAt: new Date() })
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.role, "admin"), eq(invitations.email, input.email.toLowerCase()), sql`${invitations.acceptedAt} is null`));
  return createAdminInvitation(actor, tenant, { name: input.name, email: input.email, phone: input.phone ?? null, title: input.title ?? null });
}

// ───────── Tenant 상태 전이 ─────────
export type TenantStatusAction = "activate" | "suspend" | "unsuspend" | "archive";
export type SuspendDuration = "7d" | "30d" | "indefinite";
export type StatusNotifyTarget = "all" | "admin" | "none";
export const TENANT_TRANSITIONS: Record<TenantStatusAction, { from: TenantStatus[]; to: TenantStatus; label: string }> = {
  activate: { from: ["pending"], to: "active", label: "활성화" },
  suspend: { from: ["active"], to: "suspended", label: "정지" },
  unsuspend: { from: ["suspended"], to: "active", label: "정지 해제" },
  archive: { from: ["active", "suspended"], to: "archived", label: "아카이브" },
};
export const SUSPEND_DURATION_LABEL: Record<SuspendDuration, string> = { "7d": "7일", "30d": "30일", indefinite: "무기한" };

export async function changeTenantStatus(actor: PlatformActor, tenantId: string, action: TenantStatusAction,
  opts: { reason?: string; duration?: SuspendDuration; notifyTarget?: StatusNotifyTarget } = {}) {
  const tr = TENANT_TRANSITIONS[action];
  if (!tr) throw validation("알 수 없는 상태 전이입니다");
  const reason = opts.reason?.trim() ?? "";
  if ((action === "suspend" || action === "archive") && reason.length < 10) throw validation("사유를 10자 이상 입력하세요");
  if (action === "suspend" && !opts.duration) throw validation("정지 기간을 선택하세요");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw notFound("수협을 찾을 수 없습니다");
  if (!tr.from.includes(tenant.status)) throw stateError(`현재 상태(${tenant.status})에서는 ${tr.label}할 수 없습니다`);
  if (action === "activate") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
    if (n < 1) throw stateError("활성 상태의 수협 Admin이 1명 이상 가입되어야 활성화할 수 있습니다");
  }
  const now = new Date();
  const patch: Partial<typeof tenants.$inferInsert> = { status: tr.to };
  if (action === "activate") { patch.activatedAt = tenant.activatedAt ?? now; patch.suspendReason = null; }
  if (action === "suspend") { patch.suspendedAt = now; patch.suspendReason = `${reason} (기간: ${SUSPEND_DURATION_LABEL[opts.duration!]})`; }
  if (action === "unsuspend") { patch.suspendReason = null; patch.suspendedAt = null; }
  if (action === "archive") { patch.archivedAt = now; patch.suspendReason = reason; }
  const [after] = await db.update(tenants).set(patch).where(eq(tenants.id, tenantId)).returning();
  await audit({
    tenantId, actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: `tenant.${action}`, targetType: "tenant", targetId: tenantId,
    before: { status: tenant.status, suspendReason: tenant.suspendReason }, after: { status: after.status, duration: opts.duration ?? null, notifyTarget: opts.notifyTarget ?? "admin" }, reason: reason || null,
  });

  const target = opts.notifyTarget ?? "admin";
  if (target !== "none") {
    const roles: Role[] = target === "all" ? ["admin", "operator", "receiver", "broker", "shipper", "union"] : ["admin"];
    const userIds = await usersByRoles(tenantId, roles);
    const titles: Record<TenantStatusAction, string> = {
      activate: `${tenant.name} 운영이 시작되었습니다`, suspend: `⚠ ${tenant.name} 운영이 정지되었습니다`,
      unsuspend: `${tenant.name} 정지가 해제되었습니다`, archive: `${tenant.name} 이(가) 아카이브되었습니다`,
    };
    const bodies: Record<TenantStatusAction, string> = {
      activate: "MANSUN 플랫폼에서 입고·경매·정산 기능을 사용할 수 있습니다.",
      suspend: `사유: ${reason}\n기간: ${SUSPEND_DURATION_LABEL[opts.duration ?? "indefinite"]}\n정지 중에는 조회만 가능합니다.`,
      unsuspend: "정상 운영 상태로 복귀했습니다.",
      archive: `사유: ${reason}\n데이터는 법적 보존 기간 동안 읽기 전용으로 유지됩니다.`,
    };
    await notify({ tenantId, userIds, type: "tenant_status", title: titles[action], body: bodies[action], link: `/t/${tenant.code}`, channels: ["email"], mandatory: true });
  }
  return after;
}

// ───────── 글로벌 사용자 ─────────
export const USERS_PAGE_SIZE = 30;
export async function listUsers(opts: { q?: string; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const conds = [];
  if (opts.q?.trim()) {
    const raw = opts.q.trim();
    const q = `%${raw}%`;
    const digits = raw.replace(/-/g, "");
    conds.push(or(ilike(users.name, q), ilike(users.email, q), digits ? ilike(users.phone, `%${digits}%`) : sql`false`));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
    db.select().from(users).where(where).orderBy(asc(users.name)).limit(USERS_PAGE_SIZE).offset((page - 1) * USERS_PAGE_SIZE),
  ]);
  const ids = rows.map((u) => u.id);
  const ms = ids.length ? await db.select({ userId: memberships.userId, role: memberships.role, status: memberships.status, licenseNo: memberships.licenseNo, tenantCode: tenants.code, tenantName: tenants.name })
    .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId)).where(inArray(memberships.userId, ids)) : [];
  const pas = ids.length ? await db.select({ userId: platformAdmins.userId }).from(platformAdmins).where(inArray(platformAdmins.userId, ids)) : [];
  const paSet = new Set(pas.map((p) => p.userId));
  const byUser = new Map<string, typeof ms>();
  for (const m of ms) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m]);
  return {
    rows: rows.map((u) => ({ user: u, memberships: byUser.get(u.id) ?? [], isPlatformAdmin: paSet.has(u.id) })),
    total, page, pageSize: USERS_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
}

export async function getUserDetail(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const [ms, pa, recentAudit] = await Promise.all([
    db.select({ membership: memberships, tenantCode: tenants.code, tenantName: tenants.name, tenantStatus: tenants.status })
      .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId)).where(eq(memberships.userId, userId)).orderBy(asc(tenants.name), asc(memberships.role)),
    db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1),
    db.select({ log: auditLogs, tenantName: tenants.name }).from(auditLogs).leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .where(or(eq(auditLogs.actorUserId, userId), and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, userId)))).orderBy(desc(auditLogs.at)).limit(10),
  ]);
  return { user, memberships: ms, isPlatformAdmin: pa.length > 0, recentAudit: recentAudit.map((r) => ({ ...r.log, tenantName: r.tenantName })) };
}
export type UserDetail = NonNullable<Awaited<ReturnType<typeof getUserDetail>>>;

/**
 * 글로벌 정지/해제.
 * - 정지: users.global_suspended=true + 모든 active Membership → suspended (일괄). 정지 직전 active 였던 Membership id 를 감사 로그 before 에 보존.
 * - 해제: users.global_suspended=false + 마지막 글로벌 정지 감사 로그에 기록된 Membership 중 여전히 suspended 인 것만 active 로 복원
 *   (수협 Admin 이 개별적으로 정지한 Membership 은 건드리지 않음).
 */
export async function setUserGlobalSuspended(actor: PlatformActor, userId: string, suspended: boolean, reason: string) {
  const r = reason.trim();
  if (r.length < 5) throw validation("사유를 5자 이상 입력하세요");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound("사용자를 찾을 수 없습니다");
  if (user.globalSuspended === suspended) throw stateError(suspended ? "이미 정지된 사용자입니다" : "정지 상태가 아닙니다");
  if (suspended) {
    const [pa] = await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1);
    if (pa) throw stateError("Platform Admin 계정은 글로벌 정지할 수 없습니다 (별도 SOP)");
  }
  return db.transaction(async (tx) => {
    const now = new Date();
    if (suspended) {
      const active = await tx.select({ id: memberships.id, tenantId: memberships.tenantId, role: memberships.role }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
      if (active.length) await tx.update(memberships).set({ status: "suspended", suspendedAt: now }).where(inArray(memberships.id, active.map((m) => m.id)));
      await tx.update(users).set({ globalSuspended: true }).where(eq(users.id, userId));
      await audit({ actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "user.global_suspend", targetType: "user", targetId: userId, before: { globalSuspended: false, activeMembershipIds: active.map((m) => m.id) }, after: { globalSuspended: true, suspendedMemberships: active.length }, reason: r }, tx);
      for (const m of active) await audit({ tenantId: m.tenantId, actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "membership.suspend", targetType: "membership", targetId: m.id, before: { status: "active" }, after: { status: "suspended", cause: "global_suspend" }, reason: r }, tx);
      return { restored: 0, suspended: active.length };
    }
    const [last] = await tx.select().from(auditLogs).where(and(eq(auditLogs.action, "user.global_suspend"), eq(auditLogs.targetId, userId))).orderBy(desc(auditLogs.at)).limit(1);
    const before = (last?.before ?? {}) as { activeMembershipIds?: string[] };
    const ids = before.activeMembershipIds ?? [];
    let restored: { id: string; tenantId: string }[] = [];
    if (ids.length) {
      restored = await tx.update(memberships).set({ status: "active" as MembershipStatus, suspendedAt: null })
        .where(and(inArray(memberships.id, ids), eq(memberships.userId, userId), eq(memberships.status, "suspended"))).returning({ id: memberships.id, tenantId: memberships.tenantId });
    }
    await tx.update(users).set({ globalSuspended: false }).where(eq(users.id, userId));
    await audit({ actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "user.global_unsuspend", targetType: "user", targetId: userId, before: { globalSuspended: true }, after: { globalSuspended: false, restoredMemberships: restored.length }, reason: r }, tx);
    for (const m of restored) await audit({ tenantId: m.tenantId, actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "membership.unsuspend", targetType: "membership", targetId: m.id, before: { status: "suspended" }, after: { status: "active", cause: "global_unsuspend" }, reason: r }, tx);
    return { restored: restored.length, suspended: 0 };
  });
}

// ───────── 감사 로그 ─────────
export const AUDIT_PAGE_SIZE = 50;
export interface AuditLogFilter { tenantId?: string; from?: string; to?: string; action?: string; q?: string; page?: number }
export async function platformAuditLogs(f: AuditLogFilter = {}) {
  const page = Math.max(1, f.page ?? 1);
  const conds = [];
  if (f.tenantId) conds.push(eq(auditLogs.tenantId, f.tenantId));
  if (f.from) conds.push(gte(auditLogs.at, kstDayStart(f.from)));
  if (f.to) conds.push(lte(auditLogs.at, kstDayEnd(f.to)));
  if (f.action?.trim()) conds.push(ilike(auditLogs.action, `${f.action.trim()}%`));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(auditLogs.action, q), ilike(auditLogs.targetId, q), ilike(users.name, q), ilike(auditLogs.reason, q)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where),
    db.select({ log: auditLogs, actorName: users.name, tenantName: tenants.name, tenantCode: tenants.code }).from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId)).leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .where(where).orderBy(desc(auditLogs.at)).limit(AUDIT_PAGE_SIZE).offset((page - 1) * AUDIT_PAGE_SIZE),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.log.id, at: r.log.at, action: r.log.action, targetType: r.log.targetType, targetId: r.log.targetId, before: r.log.before, after: r.log.after,
      reason: r.log.reason, ip: r.log.ip, actorName: r.actorName, actorRole: r.log.actorRole, tenantName: r.tenantName, tenantCode: r.tenantCode,
    })),
    total, page, pageSize: AUDIT_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/** 감사 로그 action 접두어 목록 (필터용) */
export async function auditActionPrefixes() {
  const rows = await db.select({ p: sql<string>`split_part(${auditLogs.action}, '.', 1)` }).from(auditLogs).groupBy(sql`split_part(${auditLogs.action}, '.', 1)`).orderBy(sql`1`);
  return rows.map((r) => r.p).filter(Boolean);
}

// ───────── 분쟁 조회 모드 ─────────
export async function startReadSession(actor: PlatformActor, tenantId: string, reason: string) {
  const r = reason.trim();
  if (r.length < 20) throw validation("조회 사유를 20자 이상 입력하세요 (예: 민원 번호·확인 대상 포함)");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw notFound("수협을 찾을 수 없습니다");
  const expiresAt = new Date(Date.now() + 4 * 3600_000);
  const [s] = await db.insert(platformReadSessions).values({ adminUserId: actor.userId, tenantId, reason: r, expiresAt }).returning();
  await audit({ tenantId, actorUserId: actor.userId, actorRole: ACTOR_ROLE, action: "platform.read_session", targetType: "tenant", targetId: tenantId, after: { readSessionId: s.id, expiresAt }, reason: r });
  // 수협 Admin 에게 조회 사실 통지 (인앱)
  const admins = await usersByRoles(tenantId, ["admin"]);
  await notify({ tenantId, userIds: admins, type: "system", title: "Platform Admin 분쟁 조회 모드 진입", body: `사유: ${r}\n(4시간 유효, 읽기 전용)`, link: `/t/${tenant.code}/admin?tab=audit` });
  return { id: s.id, expiresAt, tenantCode: tenant.code };
}

// ───────── 플랫폼 통계 ─────────
export interface TenantStatRow {
  tenantId: string; code: string; name: string; status: TenantStatus;
  rounds: number; lots: number; awardedLots: number; awardedAmount: number; brokersActive: number; activeMembers: number; avgLotsPerRound: number; avgUnitPrice: number;
}
export async function platformStats(from: string, to: string): Promise<TenantStatRow[]> {
  const [ts, agg, brokers, members] = await Promise.all([
    db.select({ id: tenants.id, code: tenants.code, name: tenants.name, status: tenants.status }).from(tenants).orderBy(asc(tenants.name)),
    withPlatform((tx) => tx.select({
      tenantId: auctions.tenantId,
      rounds: sql<number>`count(distinct ${auctions.roundId})::int`,
      lots: sql<number>`count(*)::int`,
      awardedLots: sql<number>`count(*) filter (where ${auctions.status} in ('awarded','settled'))::int`,
      awardedAmount: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.finalPrice} * ${auctions.quantity} else 0 end), 0)::float`,
      awardedQty: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.quantity} else 0 end), 0)::float`,
    }).from(auctions).innerJoin(rounds, eq(rounds.id, auctions.roundId))
      .where(and(gte(rounds.date, from), lte(rounds.date, to), ne(auctions.status, "withdrawn"))).groupBy(auctions.tenantId)),
    db.select({ tenantId: memberships.tenantId, n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.role, "broker"), eq(memberships.status, "active"))).groupBy(memberships.tenantId),
    db.select({ tenantId: memberships.tenantId, n: sql<number>`count(distinct ${memberships.userId})::int` }).from(memberships).where(eq(memberships.status, "active")).groupBy(memberships.tenantId),
  ]);
  const aggBy = new Map(agg.map((a) => [a.tenantId, a]));
  const brBy = new Map(brokers.map((b) => [b.tenantId, b.n]));
  const mBy = new Map(members.map((m) => [m.tenantId, m.n]));
  return ts.map((t) => {
    const a = aggBy.get(t.id);
    const roundsN = a?.rounds ?? 0, lots = a?.lots ?? 0, amount = Math.round(a?.awardedAmount ?? 0), qty = a?.awardedQty ?? 0;
    return {
      tenantId: t.id, code: t.code, name: t.name, status: t.status, rounds: roundsN, lots, awardedLots: a?.awardedLots ?? 0, awardedAmount: amount,
      brokersActive: brBy.get(t.id) ?? 0, activeMembers: mBy.get(t.id) ?? 0,
      avgLotsPerRound: roundsN ? Math.round((lots / roundsN) * 10) / 10 : 0, avgUnitPrice: qty ? Math.round(amount / qty) : 0,
    };
  });
}

/** 기간 내 일자별 낙찰 금액 (Tenant 비교 차트용) */
export async function platformDailyAmounts(from: string, to: string) {
  return withPlatform((tx) => tx.select({
    tenantId: auctions.tenantId, date: rounds.date,
    amount: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.finalPrice} * ${auctions.quantity} else 0 end), 0)::float`,
    lots: sql<number>`count(*)::int`,
  }).from(auctions).innerJoin(rounds, eq(rounds.id, auctions.roundId))
    .where(and(gte(rounds.date, from), lte(rounds.date, to), ne(auctions.status, "withdrawn"))).groupBy(auctions.tenantId, rounds.date).orderBy(asc(rounds.date)));
}

export const tenantOptions = async () => db.select({ id: tenants.id, code: tenants.code, name: tenants.name }).from(tenants).orderBy(asc(tenants.name));
