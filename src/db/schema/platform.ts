import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ───────── 공통 타입 ─────────
export type TenantStatus = "pending" | "active" | "suspended" | "archived";
export type Role = "admin" | "operator" | "receiver" | "broker" | "shipper" | "union";
export type MembershipStatus = "invited" | "active" | "suspended";
export type LicenseStatus = "active" | "expired" | "suspended" | "revoked";
export type TieBreakPolicy = "first_come" | "lottery" | "split" | "rebid";
export type DigitalPriceVisibility = "hidden" | "auctioneer_only" | "public";
export type WinnerDisclosure = "license_no" | "anonymous";
export type NotificationChannel = "inapp" | "sms" | "kakao" | "email";

export interface FeePolicy {
  /** 위판수수료율 (0.04 = 4%) */
  marketFeeRate: number;
  /** 중매인수수료율 (0.015 = 1.5%) */
  brokerFeeRate: number;
  /** VAT 포함 여부 */
  vatIncluded: boolean;
  vatRate: number;
}
export interface ScheduleSlot {
  seq: number;
  label: string;          // "오전 1회차"
  bidStart: string;       // "06:30"
  bidClose: string;       // "07:00"
  autoNoticeAt?: string;  // "05:00" 자동 공지 시각
  days?: number[];        // 0=일..6=토, 없으면 매일
}
/** { 어종코드: { box: kg/박스, ea: g/마리 } } */
export type BoxWeightTable = Record<string, { box?: number; ea?: number }>;
/** { 어종코드: 최저 단가 } */
export type ReservePrices = Record<string, number>;
export interface NotificationConfig {
  channels: NotificationChannel[];
  kakaoSenderKey?: string;
  smsSenderNo?: string;
}
export interface NotificationPrefs {
  inapp: boolean;
  kakao: boolean;
  sms: boolean;
  email: boolean;
  lostBidInapp: boolean;
}

// ───────── Tenant ─────────
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  region: text("region"),
  address: text("address"),
  businessNo: text("business_no"),
  status: text("status").$type<TenantStatus>().notNull().default("pending"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  feePolicy: jsonb("fee_policy").$type<FeePolicy>().notNull(),
  boxWeightTable: jsonb("box_weight_table").$type<BoxWeightTable>().notNull().default({}),
  schedule: jsonb("schedule").$type<ScheduleSlot[]>().notNull().default([]),
  reservePrices: jsonb("reserve_prices").$type<ReservePrices>().notNull().default({}),
  digitalCloseBufferMin: integer("digital_close_buffer_min").notNull().default(5),
  tieBreakPolicy: text("tie_break_policy").$type<TieBreakPolicy>().notNull().default("first_come"),
  digitalPriceVisibility: text("digital_price_visibility").$type<DigitalPriceVisibility>().notNull().default("hidden"),
  bidModificationAllowed: boolean("bid_modification_allowed").notNull().default(true),
  fieldAuctionEnabled: boolean("field_auction_enabled").notNull().default(false),
  bidMfaRequired: boolean("bid_mfa_required").notNull().default(false),
  winnerDisclosure: text("winner_disclosure").$type<WinnerDisclosure>().notNull().default("license_no"),
  accountingAdapter: text("accounting_adapter").notNull().default("mock"),
  notificationConfig: jsonb("notification_config").$type<NotificationConfig>().notNull().default({ channels: ["inapp", "kakao"] }),
  suspendReason: text("suspend_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// ───────── User (글로벌) ─────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(),
  phone: text("phone").unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  identityVerified: boolean("identity_verified").notNull().default(false),
  globalSuspended: boolean("global_suspended").notNull().default(false),
  bankAccount: text("bank_account"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// ───────── Membership (User × Tenant × Role) ─────────
export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  role: text("role").$type<Role>().notNull(),
  licenseNo: text("license_no"),
  licenseStatus: text("license_status").$type<LicenseStatus>(),
  licenseExpiresAt: date("license_expires_at"),
  squadCode: text("squad_code"),
  title: text("title"),
  status: text("status").$type<MembershipStatus>().notNull().default("invited"),
  notificationPrefs: jsonb("notification_prefs").$type<NotificationPrefs>().notNull()
    .default({ inapp: true, kakao: true, sms: false, email: true, lostBidInapp: true }),
  invitedBy: uuid("invited_by").references(() => users.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_membership_user_tenant_role").on(t.userId, t.tenantId, t.role),
  index("idx_membership_user").on(t.userId),
  index("idx_membership_tenant").on(t.tenantId),
]);

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  grantedBy: uuid("granted_by").references(() => users.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────── 초청 ─────────
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  role: text("role").$type<Role>().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  licenseNo: text("license_no"),
  title: text("title"),
  invitedBy: uuid("invited_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────── 공유 마스터: 어종 ─────────
export type BidUnit = "kg" | "box" | "ea";
export const fishSpecies = pgTable("fish_species", {
  code: text("code").primaryKey(),            // 'mackerel'
  name: text("name").notNull(),               // '고등어'
  defaultUnit: text("default_unit").$type<BidUnit>().notNull().default("kg"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

// ───────── 감사 로그 ─────────
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id"),
  actorUserId: uuid("actor_user_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),           // 'intake.confirm', 'bid.create', 'auth.login' ...
  targetType: text("target_type"),
  targetId: text("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  ip: text("ip"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_audit_tenant_at").on(t.tenantId, t.at),
  index("idx_audit_actor").on(t.actorUserId),
]);

// ───────── 알림 ─────────
export type NotificationType =
  | "notice" | "closing_soon" | "bid_confirmed" | "awarded" | "lost" | "passed"
  | "settlement_issued" | "license_expiring" | "dispute" | "system" | "otp" | "intake_new"
  | "fee_changed" | "tenant_status";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  type: text("type").$type<NotificationType>().notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_notif_user_created").on(t.userId, t.createdAt)]);

/** 외부 채널(SMS/알림톡/이메일/ERP) 발송 Mock 로그 */
export const notificationLogs = pgTable("notification_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id"),
  channel: text("channel").notNull(),          // 'sms' | 'kakao' | 'email' | 'erp'
  recipient: text("recipient"),                // 전화/이메일/엔드포인트
  userId: uuid("user_id"),
  subject: text("subject"),
  payload: jsonb("payload"),
  status: text("status").notNull().default("sent"), // 'sent' | 'failed'
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_notif_log_tenant").on(t.tenantId, t.createdAt)]);

/** OTP 코드 (dev Mock) */
export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id),
  target: text("target").notNull(),            // phone/email or 'bid:{auctionId}'
  purpose: text("purpose").notNull(),          // 'invite' | 'bid' | 'login'
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
