import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, ne, or, sql, count } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { withTenant } from "@/db/context";
import {
  tenants, users, memberships, invitations, auditLogs, auctions, disputes, fishSpecies,
  type Role, type MembershipStatus, type LicenseStatus, type Tenant, type FeePolicy, type ScheduleSlot,
  type BoxWeightTable, type ReservePrices, type NotificationConfig,
} from "@/db/schema";
import type { TenantContext } from "@/lib/auth/context";
import { FORBIDDEN_ROLE_PAIRS, ROLE_LABEL } from "@/lib/authz/matrix";
import { conflict, notFound, stateError, validation } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { localDateStr } from "@/lib/format";
import { emailAdapter } from "@/adapters/notification/mock";
import { audit } from "./audit";
import { notify, usersByRoles } from "./notification";

// ─────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────
export type SettingsSection = "general" | "auction" | "units" | "fees" | "notification" | "accounting";

const ROLES = ["admin", "operator", "receiver", "broker", "shipper", "union"] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const step = (v: number, s: number) => Math.abs(Math.round(v / s) * s - v) < 1e-9;
const optStr = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const generalSchema = z.object({
  name: z.string().trim().min(2, "수협 이름은 2~40자").max(40, "수협 이름은 2~40자"),
  region: optStr(40),
  address: optStr(120),
  contactEmail: z.union([z.literal(""), z.email("이메일 형식이 올바르지 않습니다")]).optional().nullable().transform((v) => (v ? v : null)),
  contactPhone: optStr(20).refine((v) => !v || /^[0-9-]{8,15}$/.test(v), "전화번호 형식이 올바르지 않습니다"),
  pickupInstructions: optStr(200),
});

export const scheduleSlotSchema = z.object({
  seq: z.number().int().min(1, "회차는 1 이상"),
  label: z.string().trim().min(1, "라벨을 입력하세요").max(30),
  bidStart: z.string().regex(HHMM, "시작 시각은 HH:mm"),
  bidClose: z.string().regex(HHMM, "마감 시각은 HH:mm"),
  autoNoticeAt: z.union([z.literal(""), z.string().regex(HHMM, "자동 공지 시각은 HH:mm")]).optional().transform((v) => (v ? v : undefined)),
  days: z.array(z.number().int().min(0).max(6)).optional(),
}).refine((s) => toMin(s.bidClose) > toMin(s.bidStart), { message: "마감 시각은 시작 시각 이후여야 합니다", path: ["bidClose"] });

export const auctionSchema = z.object({
  digitalCloseBufferMin: z.number().int().min(1, "디지털 마감 버퍼는 1~30분").max(30, "디지털 마감 버퍼는 1~30분"),
  tieBreakPolicy: z.enum(["first_come", "lottery", "split", "rebid"]),
  digitalPriceVisibility: z.enum(["hidden", "auctioneer_only", "public"]),
  bidModificationAllowed: z.boolean(),
  fieldAuctionEnabled: z.boolean(),
  bidMfaRequired: z.boolean(),
  winnerDisclosure: z.enum(["license_no", "anonymous"]),
  reservePrices: z.record(z.string(), z.number().int("최저가는 정수").positive("최저가는 0보다 커야 합니다")),
  schedule: z.array(scheduleSlotSchema).refine((arr) => new Set(arr.map((s) => s.seq)).size === arr.length, "회차 번호가 중복됩니다"),
});

export const unitsSchema = z.object({
  boxWeightTable: z.record(z.string(), z.object({
    box: z.number().positive("박스 중량(kg)은 0보다 커야 합니다").optional(),
    ea: z.number().positive("마리 중량(g)은 0보다 커야 합니다").optional(),
  })),
});

export const feesSchema = z.object({
  marketFeeRate: z.number().min(0, "위판수수료율은 0~10%").max(0.10, "위판수수료율은 0~10%").refine((v) => step(v, 0.001), "0.1% 단위로 입력하세요"),
  brokerFeeRate: z.number().min(0, "중매인수수료율은 0~5%").max(0.05, "중매인수수료율은 0~5%").refine((v) => step(v, 0.001), "0.1% 단위로 입력하세요"),
  vatIncluded: z.boolean(),
  vatRate: z.number().min(0, "VAT율은 0~20%").max(0.2, "VAT율은 0~20%"),
});

export const notificationSchema = z.object({
  notificationConfig: z.object({
    channels: z.array(z.enum(["inapp", "kakao", "sms", "email"])).refine((c) => c.includes("inapp"), "인앱 채널은 필수입니다"),
    kakaoSenderKey: optStr(80),
    smsSenderNo: optStr(20).refine((v) => !v || /^[0-9-]{8,15}$/.test(v), "발신번호 형식이 올바르지 않습니다"),
  }),
});

export const accountingSchema = z.object({
  accountingAdapter: z.enum(["mock"]),
});

/** 활성 경매 진행 중 변경이 잠기는 항목 */
const LOCKED_KEYS = ["tieBreakPolicy", "marketFeeRate", "brokerFeeRate", "vatIncluded", "digitalPriceVisibility", "bidModificationAllowed"] as const;
const ACTIVE_STATUSES = ["open", "closing", "closed_digital", "field_open", "rebid"] as const;

export async function hasActiveAuctions(tenantId: string) {
  const [{ n }] = await withTenant(tenantId, (tx) => tx.select({ n: count() }).from(auctions)
    .where(and(eq(auctions.tenantId, tenantId), inArray(auctions.status, [...ACTIVE_STATUSES]))));
  return n > 0;
}

type TenantPatch = Partial<Pick<Tenant, "name" | "region" | "address" | "contactEmail" | "contactPhone" | "pickupInstructions" | "digitalCloseBufferMin" | "tieBreakPolicy"
  | "digitalPriceVisibility" | "bidModificationAllowed" | "fieldAuctionEnabled" | "bidMfaRequired" | "winnerDisclosure" | "reservePrices" | "schedule"
  | "boxWeightTable" | "feePolicy" | "notificationConfig" | "accountingAdapter">>;

/** 섹션별 zod 검증 → tenants 갱신 + 감사. 활성 경매 중 잠금 항목 변경은 거부 */
export async function updateTenantSettings(ctx: TenantContext, section: SettingsSection, patch: unknown) {
  const t = ctx.tenant;
  let set: TenantPatch;
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  switch (section) {
    case "general": {
      const v = generalSchema.parse(patch);
      set = v; before = { name: t.name, region: t.region, address: t.address, contactEmail: t.contactEmail, contactPhone: t.contactPhone, pickupInstructions: t.pickupInstructions }; after = v;
      break;
    }
    case "auction": {
      const v = auctionSchema.parse(patch);
      const schedule: ScheduleSlot[] = v.schedule.map((s) => ({ seq: s.seq, label: s.label, bidStart: s.bidStart, bidClose: s.bidClose, ...(s.autoNoticeAt ? { autoNoticeAt: s.autoNoticeAt } : {}), ...(s.days ? { days: s.days } : {}) }))
        .sort((a, b) => a.seq - b.seq);
      set = { ...v, schedule, reservePrices: v.reservePrices as ReservePrices };
      before = { digitalCloseBufferMin: t.digitalCloseBufferMin, tieBreakPolicy: t.tieBreakPolicy, digitalPriceVisibility: t.digitalPriceVisibility, bidModificationAllowed: t.bidModificationAllowed, fieldAuctionEnabled: t.fieldAuctionEnabled, bidMfaRequired: t.bidMfaRequired, winnerDisclosure: t.winnerDisclosure, reservePrices: t.reservePrices, schedule: t.schedule };
      after = { ...set };
      break;
    }
    case "units": {
      const v = unitsSchema.parse(patch);
      const table: BoxWeightTable = {};
      for (const [k, c] of Object.entries(v.boxWeightTable)) if (c.box || c.ea) table[k] = { ...(c.box ? { box: c.box } : {}), ...(c.ea ? { ea: c.ea } : {}) };
      set = { boxWeightTable: table }; before = { boxWeightTable: t.boxWeightTable }; after = { boxWeightTable: table };
      break;
    }
    case "fees": {
      const v = feesSchema.parse(patch);
      const fp: FeePolicy = { marketFeeRate: v.marketFeeRate, brokerFeeRate: v.brokerFeeRate, vatIncluded: v.vatIncluded, vatRate: v.vatRate };
      set = { feePolicy: fp }; before = { ...t.feePolicy }; after = { ...fp };
      break;
    }
    case "notification": {
      const v = notificationSchema.parse(patch);
      const nc: NotificationConfig = { channels: [...new Set(v.notificationConfig.channels)], ...(v.notificationConfig.kakaoSenderKey ? { kakaoSenderKey: v.notificationConfig.kakaoSenderKey } : {}), ...(v.notificationConfig.smsSenderNo ? { smsSenderNo: v.notificationConfig.smsSenderNo } : {}) };
      set = { notificationConfig: nc }; before = { notificationConfig: t.notificationConfig }; after = { notificationConfig: nc };
      break;
    }
    case "accounting": {
      const v = accountingSchema.parse(patch);
      set = v; before = { accountingAdapter: t.accountingAdapter }; after = v;
      break;
    }
  }

  // 잠금 규칙
  const changedLocked = LOCKED_KEYS.filter((k) => k in after && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  if (changedLocked.length && (await hasActiveAuctions(t.id))) {
    throw stateError("활성 경매 진행 중에는 변경할 수 없습니다. 다음 회차부터 적용됩니다");
  }

  const [updated] = await db.update(tenants).set(set).where(eq(tenants.id, t.id)).returning();
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: `tenant.settings.${section}`, targetType: "tenant", targetId: t.id, before, after });

  if (section === "fees") {
    const fp = updated.feePolicy;
    const changed = fp.marketFeeRate !== t.feePolicy.marketFeeRate || fp.brokerFeeRate !== t.feePolicy.brokerFeeRate || fp.vatIncluded !== t.feePolicy.vatIncluded || fp.vatRate !== t.feePolicy.vatRate;
    if (changed) {
      const targets = await usersByRoles(t.id, ["broker", "operator"]);
      await notify({
        tenantId: t.id, userIds: targets, type: "fee_changed", title: "수수료 정책이 변경되었습니다",
        body: `위판수수료 ${pct(fp.marketFeeRate)} · 중매인수수료 ${pct(fp.brokerFeeRate)} · VAT ${fp.vatIncluded ? "포함" : "별도"} (다음 회차부터 적용)`,
        channels: ["kakao"],
      });
    }
  }
  return updated;
}
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

// ─────────────────────────────────────────────────────────────
// 멤버
// ─────────────────────────────────────────────────────────────
export interface MemberRow {
  userId: string; name: string; email: string | null; phone: string | null; lastLoginAt: Date | null; identityVerified: boolean;
  memberships: { id: string; role: Role; status: MembershipStatus; licenseNo: string | null; licenseStatus: LicenseStatus | null; licenseExpiresAt: string | null; title: string | null; joinedAt: Date | null; createdAt: Date }[];
}

/** 사용자 단위로 묶은 멤버 목록 (역할·상태 필터는 Membership 기준) */
export async function listMembers(tenantId: string, opts: { role?: Role; status?: MembershipStatus; q?: string } = {}): Promise<MemberRow[]> {
  const conds = [eq(memberships.tenantId, tenantId)];
  if (opts.role) conds.push(eq(memberships.role, opts.role));
  if (opts.status) conds.push(eq(memberships.status, opts.status));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    conds.push(or(ilike(users.name, q), ilike(users.email, q), ilike(users.phone, q.replace(/-/g, "")))!);
  }
  const rows = await db.select({ m: memberships, u: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(...conds)).orderBy(asc(users.name), asc(memberships.role));
  const map = new Map<string, MemberRow>();
  for (const { m, u } of rows) {
    const row = map.get(u.id) ?? { userId: u.id, name: u.name, email: u.email, phone: u.phone, lastLoginAt: u.lastLoginAt, identityVerified: u.identityVerified, memberships: [] };
    row.memberships.push({ id: m.id, role: m.role, status: m.status, licenseNo: m.licenseNo, licenseStatus: m.licenseStatus, licenseExpiresAt: m.licenseExpiresAt, title: m.title, joinedAt: m.joinedAt, createdAt: m.createdAt });
    map.set(u.id, row);
  }
  return [...map.values()];
}

/** 미수락 초청 (만료 여부 플래그 포함 — 만료건은 재발송 대상) */
export async function listInvitations(tenantId: string) {
  const rows = await db.select({ inv: invitations, inviterName: users.name }).from(invitations).leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(and(eq(invitations.tenantId, tenantId), isNull(invitations.acceptedAt))).orderBy(desc(invitations.createdAt)).limit(100);
  const now = Date.now();
  return rows.map((r) => ({ ...r.inv, inviterName: r.inviterName, expired: r.inv.expiresAt.getTime() <= now }));
}

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "이름은 2~20자").max(20, "이름은 2~20자"),
  email: z.email("이메일 형식이 올바르지 않습니다").transform((v) => v.toLowerCase()),
  phone: z.union([z.literal(""), z.string().regex(/^[0-9-]{9,15}$/, "전화번호 형식이 올바르지 않습니다")]).optional().nullable().transform((v) => (v ? v.replace(/-/g, "") : null)),
  role: z.enum(ROLES),
  licenseNo: optStr(30),
  title: optStr(30),
  licenseExpiresAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "만료일 형식은 YYYY-MM-DD")]).optional().nullable().transform((v) => (v ? v : null)),
});
export type InviteInput = z.input<typeof inviteSchema>;

function forbiddenPairMessage(existing: Role[], adding: Role) {
  for (const [a, b] of FORBIDDEN_ROLE_PAIRS) {
    if ((adding === a && existing.includes(b)) || (adding === b && existing.includes(a))) {
      return `${ROLE_LABEL[a]}와(과) ${ROLE_LABEL[b]} 역할은 같은 사용자가 겸임할 수 없습니다`;
    }
  }
  return null;
}

async function assertLicenseUnique(tenantId: string, licenseNo: string, exceptMembershipId?: string) {
  const dup = await db.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.licenseNo, licenseNo), ...(exceptMembershipId ? [ne(memberships.id, exceptMembershipId)] : []))).limit(1);
  if (dup.length) throw conflict(`면허번호 ${licenseNo} 는 이미 등록되어 있습니다`);
  const dupInv = await db.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.licenseNo, licenseNo), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))).limit(1);
  if (dupInv.length) throw conflict(`면허번호 ${licenseNo} 로 진행 중인 초청이 있습니다`);
}

async function requestOrigin() {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  } catch { /* 요청 컨텍스트 없음 */ }
  return process.env.APP_ORIGIN ?? "http://localhost:3100";
}

const newToken = () => randomUUID().replace(/-/g, "");
const INVITE_TTL_MS = 7 * 24 * 3600_000;

async function sendInviteMail(tenant: Tenant, inv: { email: string; name: string; role: Role; token: string; expiresAt: Date }) {
  const link = `${await requestOrigin()}/invite/${inv.token}`;
  await emailAdapter.send({
    tenantId: tenant.id, recipient: inv.email, subject: `[MANSUN] ${tenant.name} ${ROLE_LABEL[inv.role]} 초청`,
    body: `${inv.name}님, ${tenant.name}에서 ${ROLE_LABEL[inv.role]} 역할로 초청했습니다.\n아래 링크에서 가입을 완료하세요 (${inv.expiresAt.toISOString().slice(0, 10)}까지 유효)\n${link}`,
    meta: { type: "invite", link },
  });
  return link;
}

/** 멤버 초청: 초청 row 생성 + 메일(Mock) 발송. dev 편의를 위해 링크 반환 */
export async function inviteMember(ctx: TenantContext, input: InviteInput) {
  const v = inviteSchema.parse(input);
  const t = ctx.tenant;
  if (v.role === "broker" && !v.licenseNo) throw validation("중매인은 면허번호가 필요합니다");
  if (v.role !== "broker") { v.licenseNo = null; v.licenseExpiresAt = null; }

  const [u] = await db.select().from(users).where(or(eq(users.email, v.email), ...(v.phone ? [eq(users.phone, v.phone)] : []))).limit(1);
  if (u) {
    const ms = await db.select({ role: memberships.role, status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, t.id), eq(memberships.userId, u.id)));
    const same = ms.find((m) => m.role === v.role);
    if (same?.status === "active") throw conflict(`이미 ${ROLE_LABEL[v.role]} 역할로 가입된 사용자입니다`);
    const msg = forbiddenPairMessage(ms.map((m) => m.role), v.role);
    if (msg) throw validation(msg);
  }
  const [pending] = await db.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.tenantId, t.id), eq(invitations.email, v.email), eq(invitations.role, v.role), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))).limit(1);
  if (pending) throw conflict("같은 이메일·역할로 진행 중인 초청이 있습니다. 재발송을 이용하세요");
  if (v.licenseNo) await assertLicenseUnique(t.id, v.licenseNo);

  const [inv] = await db.insert(invitations).values({
    token: newToken(), tenantId: t.id, role: v.role, name: v.name, email: v.email, phone: v.phone, licenseNo: v.licenseNo, title: v.title,
    invitedBy: ctx.session.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  }).returning();
  const inviteLink = await sendInviteMail(t, inv);
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "membership.invite", targetType: "invitation", targetId: inv.id,
    after: { name: v.name, email: v.email, role: v.role, licenseNo: v.licenseNo, title: v.title, licenseExpiresAt: v.licenseExpiresAt, expiresAt: inv.expiresAt } });
  return { invitationId: inv.id, inviteLink };
}

export async function resendInvitation(ctx: TenantContext, invitationId: string) {
  const t = ctx.tenant;
  const [inv] = await db.select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, t.id))).limit(1);
  if (!inv) throw notFound("초청을 찾을 수 없습니다");
  if (inv.acceptedAt) throw stateError("이미 수락된 초청입니다");
  const [next] = await db.update(invitations).set({ token: newToken(), expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedBy: ctx.session.userId }).where(eq(invitations.id, inv.id)).returning();
  const inviteLink = await sendInviteMail(t, next);
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "membership.invite_resend", targetType: "invitation", targetId: inv.id,
    before: { expiresAt: inv.expiresAt }, after: { email: inv.email, role: inv.role, expiresAt: next.expiresAt } });
  return { invitationId: inv.id, inviteLink };
}

export async function cancelInvitation(ctx: TenantContext, invitationId: string) {
  const t = ctx.tenant;
  const [inv] = await db.select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, t.id))).limit(1);
  if (!inv) throw notFound("초청을 찾을 수 없습니다");
  if (inv.acceptedAt) throw stateError("이미 수락된 초청은 취소할 수 없습니다");
  await db.delete(invitations).where(eq(invitations.id, inv.id));
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "membership.invite_cancel", targetType: "invitation", targetId: inv.id,
    before: { name: inv.name, email: inv.email, role: inv.role, licenseNo: inv.licenseNo } });
}

const isExpiredDate = (d: string | null | undefined) => !!d && d < localDateStr();

/** Membership 정지/활성. 중매인 정지 시 면허도 정지, 복구 시 만료일에 따라 active/expired */
export async function setMembershipStatus(ctx: TenantContext, membershipId: string, status: "active" | "suspended", reason?: string | null) {
  const t = ctx.tenant;
  const [m] = await db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, t.id))).limit(1);
  if (!m) throw notFound("멤버를 찾을 수 없습니다");
  if (m.userId === ctx.session.userId && status === "suspended") throw validation("본인 계정은 정지할 수 없습니다");
  if (m.status === status) throw stateError(`이미 ${status === "active" ? "활성" : "정지"} 상태입니다`);
  if (status === "suspended" && !reason?.trim()) throw validation("정지 사유를 입력하세요");

  const patch: Partial<typeof memberships.$inferInsert> = { status };
  if (status === "suspended") {
    patch.suspendedAt = new Date();
    if (m.role === "broker" && m.licenseStatus !== "revoked") patch.licenseStatus = "suspended";
  } else {
    patch.suspendedAt = null;
    if (!m.joinedAt) patch.joinedAt = new Date();
    if (m.role === "broker" && m.licenseStatus === "suspended") patch.licenseStatus = isExpiredDate(m.licenseExpiresAt) ? "expired" : "active";
  }
  const [after] = await db.update(memberships).set(patch).where(eq(memberships.id, m.id)).returning();
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: status === "suspended" ? "membership.suspend" : "membership.activate", targetType: "membership", targetId: m.id,
    before: { status: m.status, licenseStatus: m.licenseStatus }, after: { status: after.status, licenseStatus: after.licenseStatus, role: m.role }, reason: reason ?? null });
  await notify({ tenantId: t.id, userIds: [m.userId], type: "system", title: status === "suspended" ? `${t.name} ${ROLE_LABEL[m.role]} 권한이 정지되었습니다` : `${t.name} ${ROLE_LABEL[m.role]} 권한이 다시 활성화되었습니다`, body: reason ?? undefined, mandatory: true });
  return after;
}

/** 기존 사용자에게 역할 추가 (이해충돌 조합 금지) */
export async function addRoleToUser(ctx: TenantContext, userId: string, role: Role, licenseNo?: string | null) {
  const t = ctx.tenant;
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound("사용자를 찾을 수 없습니다");
  const ms = await db.select().from(memberships).where(and(eq(memberships.tenantId, t.id), eq(memberships.userId, userId)));
  if (ms.length === 0) throw validation("이 수협의 멤버가 아닌 사용자입니다. 초청을 이용하세요");
  if (ms.some((m) => m.role === role)) throw conflict(`이미 ${ROLE_LABEL[role]} 역할을 보유하고 있습니다`);
  const msg = forbiddenPairMessage(ms.map((m) => m.role), role);
  if (msg) throw validation(msg);
  const lic = licenseNo?.trim() || null;
  if (role === "broker") {
    if (!lic) throw validation("중매인은 면허번호가 필요합니다");
    await assertLicenseUnique(t.id, lic);
  }
  const [m] = await db.insert(memberships).values({
    userId, tenantId: t.id, role, licenseNo: role === "broker" ? lic : null, licenseStatus: role === "broker" ? "active" : null,
    status: "active", invitedBy: ctx.session.userId, joinedAt: new Date(),
  }).returning();
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "membership.add_role", targetType: "membership", targetId: m.id, after: { userId, role, licenseNo: m.licenseNo } });
  await notify({ tenantId: t.id, userIds: [userId], type: "system", title: `${t.name}에서 ${ROLE_LABEL[role]} 역할이 추가되었습니다`, mandatory: true });
  return m;
}

// ─────────────────────────────────────────────────────────────
// 중매인 면허
// ─────────────────────────────────────────────────────────────
export async function listBrokers(tenantId: string) {
  const rows = await db.select({ m: memberships, u: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "broker"))).orderBy(asc(memberships.licenseNo));
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const stats = await withTenant(tenantId, (tx) => tx.select({
    membershipId: auctions.winnerMembershipId,
    lots: sql<number>`count(*)::int`,
    amount: sql<number>`coalesce(sum(${auctions.finalPrice} * ${auctions.quantity}), 0)::bigint`,
    lastAwardedAt: sql<Date | null>`max(${auctions.awardedAt})`,
  }).from(auctions).where(and(eq(auctions.tenantId, tenantId), inArray(auctions.status, ["awarded", "settled"]), sql`${auctions.awardedAt} >= ${since}::timestamptz`))
    .groupBy(auctions.winnerMembershipId));
  const byId = new Map(stats.filter((s) => s.membershipId).map((s) => [s.membershipId as string, s]));
  const today = localDateStr();
  return rows.map(({ m, u }) => {
    const s = byId.get(m.id);
    const daysLeft = m.licenseExpiresAt ? Math.ceil((new Date(`${m.licenseExpiresAt}T00:00:00+09:00`).getTime() - new Date(`${today}T00:00:00+09:00`).getTime()) / 86_400_000) : null;
    return {
      membershipId: m.id, userId: u.id, name: u.name, phone: u.phone, email: u.email,
      licenseNo: m.licenseNo, licenseStatus: m.licenseStatus, licenseExpiresAt: m.licenseExpiresAt, membershipStatus: m.status, joinedAt: m.joinedAt,
      daysLeft, awardedLots30d: s?.lots ?? 0, awardedAmount30d: Number(s?.amount ?? 0), lastAwardedAt: s?.lastAwardedAt ? new Date(s.lastAwardedAt) : null,
    };
  });
}
export type BrokerRow = Awaited<ReturnType<typeof listBrokers>>[number];

export const licenseSchema = z.object({
  licenseNo: optStr(30),
  licenseStatus: z.enum(["active", "expired", "suspended", "revoked"]).optional(),
  /** undefined = 변경 없음, "" | null = 만료일 삭제 */
  licenseExpiresAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "만료일 형식은 YYYY-MM-DD")]).optional().nullable().transform((v) => (v === undefined ? undefined : v ? v : null)),
});
export type LicenseInput = z.input<typeof licenseSchema>;

/** 면허 갱신/정지/취소. revoked 는 종료 상태, expired→active 는 새 만료일이 오늘 이후여야 함 */
export async function updateLicense(ctx: TenantContext, membershipId: string, input: LicenseInput, reason?: string | null) {
  const t = ctx.tenant;
  const v = licenseSchema.parse(input);
  const [m] = await db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, t.id), eq(memberships.role, "broker"))).limit(1);
  if (!m) throw notFound("중매인을 찾을 수 없습니다");

  const patch: Partial<typeof memberships.$inferInsert> = {};
  if (v.licenseNo && v.licenseNo !== m.licenseNo) { await assertLicenseUnique(t.id, v.licenseNo, m.id); patch.licenseNo = v.licenseNo; }
  if (v.licenseExpiresAt !== undefined && v.licenseExpiresAt !== m.licenseExpiresAt) patch.licenseExpiresAt = v.licenseExpiresAt;
  const nextExpires = patch.licenseExpiresAt !== undefined ? patch.licenseExpiresAt : m.licenseExpiresAt;

  if (v.licenseStatus && v.licenseStatus !== m.licenseStatus) {
    const cur = m.licenseStatus ?? "active";
    if (cur === "revoked") throw stateError("취소된 면허는 상태를 변경할 수 없습니다");
    if (v.licenseStatus === "active" && isExpiredDate(nextExpires)) throw stateError("만료일이 지난 면허는 유효 상태로 변경할 수 없습니다. 만료일을 먼저 연장하세요");
    if ((v.licenseStatus === "suspended" || v.licenseStatus === "revoked") && !reason?.trim()) throw validation("정지/취소 사유를 입력하세요");
    patch.licenseStatus = v.licenseStatus;
  } else if (m.licenseStatus === "expired" && patch.licenseExpiresAt && !isExpiredDate(patch.licenseExpiresAt)) {
    patch.licenseStatus = "active"; // 만료 면허의 만료일 연장 = 갱신
  } else if (m.licenseStatus === "active" && patch.licenseExpiresAt !== undefined && isExpiredDate(patch.licenseExpiresAt)) {
    throw validation("만료일은 오늘 이후여야 합니다");
  }
  if (Object.keys(patch).length === 0) throw validation("변경된 내용이 없습니다");

  const [after] = await db.update(memberships).set(patch).where(eq(memberships.id, m.id)).returning();
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "license.update", targetType: "membership", targetId: m.id,
    before: { licenseNo: m.licenseNo, licenseStatus: m.licenseStatus, licenseExpiresAt: m.licenseExpiresAt },
    after: { licenseNo: after.licenseNo, licenseStatus: after.licenseStatus, licenseExpiresAt: after.licenseExpiresAt }, reason: reason ?? null });
  const statusLabel: Record<LicenseStatus, string> = { active: "유효", expired: "만료", suspended: "정지", revoked: "취소" };
  await notify({
    tenantId: t.id, userIds: [m.userId], type: "system", title: `중매인 면허 정보가 변경되었습니다`,
    body: `면허번호 ${after.licenseNo ?? "-"} · 상태 ${statusLabel[after.licenseStatus ?? "active"]} · 만료일 ${after.licenseExpiresAt ?? "-"}${reason ? `\n사유: ${reason}` : ""}`,
    channels: ["kakao"], mandatory: true,
  });
  return after;
}

/** 만료 임박(또는 이미 만료) 면허 — days 이내 */
export async function listExpiringLicenses(tenantId: string, days = 30) {
  const limit = new Date(Date.now() + days * 86_400_000);
  const limitStr = localDateStr(limit);
  const rows = await db.select({ membershipId: memberships.id, name: users.name, licenseNo: memberships.licenseNo, licenseStatus: memberships.licenseStatus, licenseExpiresAt: memberships.licenseExpiresAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "broker"), eq(memberships.status, "active"), inArray(memberships.licenseStatus, ["active", "expired"]),
      sql`${memberships.licenseExpiresAt} is not null and ${memberships.licenseExpiresAt} <= ${limitStr}`))
    .orderBy(asc(memberships.licenseExpiresAt));
  const today = new Date(`${localDateStr()}T00:00:00+09:00`).getTime();
  return rows.map((r) => ({ ...r, daysLeft: r.licenseExpiresAt ? Math.ceil((new Date(`${r.licenseExpiresAt}T00:00:00+09:00`).getTime() - today) / 86_400_000) : null }));
}

// ─────────────────────────────────────────────────────────────
// 선주
// ─────────────────────────────────────────────────────────────
export const shipperSchema = z.object({
  name: z.string().trim().min(2, "이름은 2~20자").max(20, "이름은 2~20자"),
  email: z.union([z.literal(""), z.email("이메일 형식이 올바르지 않습니다")]).optional().nullable().transform((v) => (v ? v.toLowerCase() : null)),
  phone: z.string().trim().regex(/^[0-9-]{9,15}$/, "전화번호 형식이 올바르지 않습니다").transform((v) => v.replace(/-/g, "")),
  bankAccount: optStr(60),
});
export type ShipperInput = z.input<typeof shipperSchema>;

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % chars.length];
  return out;
}

/** 선주 등록: 기존 사용자(이메일/전화 일치) 재사용 또는 임시 비밀번호로 생성 → shipper Membership active */
export async function registerShipper(ctx: TenantContext, input: ShipperInput) {
  const t = ctx.tenant;
  const v = shipperSchema.parse(input);
  const [existing] = await db.select().from(users).where(or(eq(users.phone, v.phone), ...(v.email ? [eq(users.email, v.email)] : []))).limit(1);
  let userId: string;
  let temp: string | null = null;
  if (existing) {
    userId = existing.id;
    const dup = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, t.id), eq(memberships.userId, userId), eq(memberships.role, "shipper"))).limit(1);
    if (dup.length) throw conflict("이미 선주로 등록된 사용자입니다");
    if (v.bankAccount && !existing.bankAccount) await db.update(users).set({ bankAccount: v.bankAccount }).where(eq(users.id, userId));
  } else {
    temp = tempPassword();
    const [u] = await db.insert(users).values({ name: v.name, email: v.email, phone: v.phone, passwordHash: await hashPassword(temp), identityVerified: false, bankAccount: v.bankAccount }).returning();
    userId = u.id;
  }
  const [m] = await db.insert(memberships).values({ userId, tenantId: t.id, role: "shipper", status: "active", invitedBy: ctx.session.userId, joinedAt: new Date() }).returning();
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "shipper.register", targetType: "membership", targetId: m.id,
    after: { userId, name: v.name, email: v.email, phone: v.phone, bankAccount: v.bankAccount ? "***" : null, newUser: !existing } });
  await notify({ tenantId: t.id, userIds: [userId], type: "system", title: `${t.name} 선주로 등록되었습니다`, body: temp ? "임시 비밀번호로 로그인 후 비밀번호를 변경하세요" : undefined, channels: ["sms"], mandatory: true });
  return { userId, membershipId: m.id, tempPassword: process.env.NODE_ENV === "production" ? null : temp };
}

export const shipperPatchSchema = z.object({
  phone: z.union([z.literal(""), z.string().trim().regex(/^[0-9-]{9,15}$/, "전화번호 형식이 올바르지 않습니다")]).optional().nullable().transform((v) => (v ? v.replace(/-/g, "") : undefined)),
  bankAccount: z.string().trim().max(60).optional().nullable(),
});

export async function updateShipper(ctx: TenantContext, userId: string, input: z.input<typeof shipperPatchSchema>) {
  const t = ctx.tenant;
  const v = shipperPatchSchema.parse(input);
  const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, t.id), eq(memberships.userId, userId), eq(memberships.role, "shipper"))).limit(1);
  if (!m) throw notFound("선주를 찾을 수 없습니다");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound("사용자를 찾을 수 없습니다");
  const patch: Partial<typeof users.$inferInsert> = {};
  if (v.phone && v.phone !== u.phone) {
    const [dup] = await db.select({ id: users.id }).from(users).where(and(eq(users.phone, v.phone), ne(users.id, userId))).limit(1);
    if (dup) throw conflict("다른 사용자가 사용 중인 전화번호입니다");
    patch.phone = v.phone;
  }
  if (v.bankAccount !== undefined && (v.bankAccount || null) !== u.bankAccount) patch.bankAccount = v.bankAccount || null;
  if (Object.keys(patch).length === 0) throw validation("변경된 내용이 없습니다");
  const [after] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  await audit({ tenantId: t.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "shipper.update", targetType: "user", targetId: userId,
    before: { phone: u.phone, bankAccount: u.bankAccount ? "***" : null }, after: { phone: after.phone, bankAccount: after.bankAccount ? "***" : null } });
  return after;
}

// ─────────────────────────────────────────────────────────────
// 감사 로그
// ─────────────────────────────────────────────────────────────
export interface AuditLogQuery { from?: string; to?: string; action?: string; actorUserId?: string; q?: string; page?: number; pageSize?: number }

export async function listAuditLogs(tenantId: string, opts: AuditLogQuery = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const conds = [eq(auditLogs.tenantId, tenantId)];
  if (opts.from) conds.push(sql`${auditLogs.at} >= ${new Date(`${opts.from}T00:00:00+09:00`).toISOString()}::timestamptz`);
  if (opts.to) conds.push(sql`${auditLogs.at} < ${new Date(new Date(`${opts.to}T00:00:00+09:00`).getTime() + 86_400_000).toISOString()}::timestamptz`);
  if (opts.action) conds.push(opts.action.endsWith("%") ? ilike(auditLogs.action, opts.action) : eq(auditLogs.action, opts.action));
  if (opts.actorUserId) conds.push(eq(auditLogs.actorUserId, opts.actorUserId));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    conds.push(or(ilike(auditLogs.action, q), ilike(auditLogs.targetId, q), ilike(auditLogs.targetType, q), ilike(auditLogs.reason, q), ilike(users.name, q), sql`${auditLogs.after}::text ilike ${q}`)!);
  }
  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ l: auditLogs, actorName: users.name }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where).orderBy(desc(auditLogs.at)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where),
  ]);
  return {
    rows: rows.map(({ l, actorName }) => ({ id: l.id, at: l.at, action: l.action, targetType: l.targetType, targetId: l.targetId, before: l.before, after: l.after, reason: l.reason, ip: l.ip, actorName, actorRole: l.actorRole, actorUserId: l.actorUserId })),
    total, page, pageSize,
  };
}

export async function distinctActions(tenantId: string) {
  const rows = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(asc(auditLogs.action));
  return rows.map((r) => r.action);
}

// ─────────────────────────────────────────────────────────────
// 대시보드 KPI
// ─────────────────────────────────────────────────────────────
export async function adminKpis(tenantId: string) {
  const [byRole, [{ pendingInvites }], [{ openDisputes }], expiring] = await Promise.all([
    db.select({ role: memberships.role, status: memberships.status, n: count() }).from(memberships).where(eq(memberships.tenantId, tenantId)).groupBy(memberships.role, memberships.status),
    db.select({ pendingInvites: count() }).from(invitations).where(and(eq(invitations.tenantId, tenantId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))),
    withTenant(tenantId, (tx) => tx.select({ openDisputes: count() }).from(disputes).where(and(eq(disputes.tenantId, tenantId), eq(disputes.status, "open")))),
    listExpiringLicenses(tenantId, 30),
  ]);
  const activeMembers = byRole.filter((r) => r.status === "active").reduce((s, r) => s + r.n, 0);
  const activeByRole = Object.fromEntries(ROLES.map((r) => [r, byRole.filter((x) => x.role === r && x.status === "active").reduce((s, x) => s + x.n, 0)])) as Record<Role, number>;
  const suspended = byRole.filter((r) => r.status === "suspended").reduce((s, r) => s + r.n, 0);
  return { activeMembers, activeByRole, suspended, brokers: activeByRole.broker, expiringLicenses: expiring.length, pendingInvites, openDisputes };
}

/** 어종 코드 → 이름 (설정 화면 표시용) */
export async function speciesNames() {
  const rows = await db.select({ code: fishSpecies.code, name: fishSpecies.name }).from(fishSpecies);
  return Object.fromEntries(rows.map((r) => [r.code, r.name])) as Record<string, string>;
}
