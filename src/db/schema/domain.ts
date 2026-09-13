import {
  pgTable, uuid, text, timestamp, boolean, integer, bigint, jsonb, index, uniqueIndex, date, doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users, memberships, type BidUnit, type NotificationChannel } from "./platform";

export type RoundStatus = "scheduled" | "announced" | "in_progress" | "auctioning" | "done" | "cancelled";
export type IntakeStatus = "draft" | "confirmed" | "announced" | "corrected" | "deleted";
export type AuctionStatus =
  | "registered" | "announced" | "open" | "closing" | "closed_digital" | "field_open"
  | "rebid" | "awarded" | "passed" | "disputed" | "settled" | "withdrawn";
export type BidStatus = "submitted" | "closed" | "awarded" | "lost" | "invalid";
export type AwardSource = "digital" | "field" | "none";
export type SettlementStatus = "pending" | "confirmed" | "paid";
export type SettlementPartyType = "shipper" | "broker";
export type NoticeMode = "auto" | "manual";
export type NoticeTarget = "broker" | "union" | "staff" | "shipper";
export type DisputeStatus = "open" | "approved" | "rejected" | "resolved";
export type Grade = "A" | "B" | "C";

const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id);

// ───────── 선박 ─────────
export const vessels = pgTable("vessels", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  name: text("name").notNull(),
  registrationNo: text("registration_no"),
  shipperUserId: uuid("shipper_user_id").references(() => users.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_vessel_tenant").on(t.tenantId), index("idx_vessel_shipper").on(t.shipperUserId)]);

// ───────── 회차 ─────────
export const rounds = pgTable("rounds", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  date: date("date").notNull(),                 // 경매 일자 (Tenant 로컬)
  seq: integer("seq").notNull(),                // 1, 2 ...
  label: text("label").notNull(),               // "5/12 오전 1회차"
  bidStartAt: timestamp("bid_start_at", { withTimezone: true }).notNull(),
  bidCloseAt: timestamp("bid_close_at", { withTimezone: true }).notNull(),
  fieldStartAt: timestamp("field_start_at", { withTimezone: true }),
  status: text("status").$type<RoundStatus>().notNull().default("scheduled"),
  closingNotifiedAt: timestamp("closing_notified_at", { withTimezone: true }),
  autoNoticedAt: timestamp("auto_noticed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_round_tenant_date_seq").on(t.tenantId, t.date, t.seq)]);

// ───────── 입고 (선박 입항 헤더) ─────────
export const intakes = pgTable("intakes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  vesselId: uuid("vessel_id").notNull().references(() => vessels.id),
  roundId: uuid("round_id").references(() => rounds.id),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull(),
  status: text("status").$type<IntakeStatus>().notNull().default("draft"),
  note: text("note"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  clientRef: text("client_ref"),               // 오프라인 큐 idempotency key
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_intake_tenant_arrived").on(t.tenantId, t.arrivedAt),
  uniqueIndex("uq_intake_client_ref").on(t.tenantId, t.clientRef),
]);

// ───────── 경매 물품(로트) ─────────
export const auctions = pgTable("auctions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  intakeId: uuid("intake_id").notNull().references(() => intakes.id),
  roundId: uuid("round_id").references(() => rounds.id),
  auctionNo: text("auction_no"),                // gangu-20260512-1A01 (확정 시 부여)
  tankNo: text("tank_no"),
  speciesCode: text("species_code").notNull(),
  weightKg: doublePrecision("weight_kg").notNull(),
  unit: text("unit").$type<BidUnit>().notNull().default("kg"),
  quantity: doublePrecision("quantity").notNull(), // 단위 기준 수량 (kg면 weight, box면 박스 수, ea면 마리 수)
  grade: text("grade").$type<Grade>().notNull().default("A"),
  note: text("note"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  status: text("status").$type<AuctionStatus>().notNull().default("registered"),
  reservePrice: integer("reserve_price"),
  bidCount: integer("bid_count").notNull().default(0),
  digitalHighPrice: integer("digital_high_price"),
  fieldHighPrice: integer("field_high_price"),
  fieldWinnerMembershipId: uuid("field_winner_membership_id").references(() => memberships.id),
  fieldNote: text("field_note"),
  fieldEnteredBy: uuid("field_entered_by").references(() => users.id),
  fieldEnteredAt: timestamp("field_entered_at", { withTimezone: true }),
  finalPrice: integer("final_price"),
  winnerMembershipId: uuid("winner_membership_id").references(() => memberships.id),
  awardSource: text("award_source").$type<AwardSource>(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }),
  rebidUntil: timestamp("rebid_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_auction_tenant_round").on(t.tenantId, t.roundId),
  index("idx_auction_tenant_status").on(t.tenantId, t.status),
  uniqueIndex("uq_auction_no").on(t.auctionNo),
]);

// ───────── 입찰 ─────────
export const bids = pgTable("bids", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  auctionId: uuid("auction_id").notNull().references(() => auctions.id),
  brokerMembershipId: uuid("broker_membership_id").notNull().references(() => memberships.id),
  brokerUserId: uuid("broker_user_id").notNull().references(() => users.id),
  price: integer("price").notNull(),
  memo: text("memo"),
  status: text("status").$type<BidStatus>().notNull().default("submitted"),
  revision: integer("revision").notNull().default(1),
  isRebid: boolean("is_rebid").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
}, (t) => [
  uniqueIndex("uq_bid_auction_broker").on(t.auctionId, t.brokerMembershipId),
  index("idx_bid_tenant_auction").on(t.tenantId, t.auctionId),
  index("idx_bid_broker").on(t.brokerMembershipId),
]);

export const bidRevisions = pgTable("bid_revisions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  bidId: uuid("bid_id").notNull().references(() => bids.id),
  revision: integer("revision").notNull(),
  price: integer("price").notNull(),
  memo: text("memo"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
});

// ───────── 개찰 결과 (append-only) ─────────
export const auctionResults = pgTable("auction_results", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  auctionId: uuid("auction_id").notNull().references(() => auctions.id),
  attempt: integer("attempt").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  outcome: text("outcome").$type<"awarded" | "passed" | "split" | "rebid">().notNull(),
  finalPrice: integer("final_price"),
  digitalHighPrice: integer("digital_high_price"),
  fieldHighPrice: integer("field_high_price"),
  source: text("source").$type<AwardSource>().notNull(),
  winnerMembershipId: uuid("winner_membership_id").references(() => memberships.id),
  /** split 낙찰 시 [{membershipId, share}] */
  winners: jsonb("winners").$type<{ membershipId: string; share: number }[]>(),
  tieBreak: text("tie_break"),
  decidedBy: uuid("decided_by").references(() => users.id), // null=system
  reason: text("reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_result_auction").on(t.auctionId)]);

// ───────── 정산 ─────────
export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  settlementNo: text("settlement_no").notNull(),
  partyType: text("party_type").$type<SettlementPartyType>().notNull(),
  partyUserId: uuid("party_user_id").notNull().references(() => users.id),
  partyMembershipId: uuid("party_membership_id").references(() => memberships.id),
  lotCount: integer("lot_count").notNull().default(0),
  grossAmount: bigint("gross_amount", { mode: "number" }).notNull().default(0),
  feeAmount: bigint("fee_amount", { mode: "number" }).notNull().default(0),
  vatAmount: bigint("vat_amount", { mode: "number" }).notNull().default(0),
  netAmount: bigint("net_amount", { mode: "number" }).notNull().default(0), // 선주: 지급액 / 중매인: 청구액
  feeRate: doublePrecision("fee_rate").notNull(),
  status: text("status").$type<SettlementStatus>().notNull().default("pending"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  erpRef: text("erp_ref"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_settlement_no").on(t.settlementNo),
  uniqueIndex("uq_settlement_round_party").on(t.roundId, t.partyType, t.partyUserId),
  index("idx_settlement_tenant").on(t.tenantId, t.roundId),
]);

export const settlementLines = pgTable("settlement_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  settlementId: uuid("settlement_id").notNull().references(() => settlements.id),
  auctionId: uuid("auction_id").notNull().references(() => auctions.id),
  quantity: doublePrecision("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  grossAmount: bigint("gross_amount", { mode: "number" }).notNull(),
  feeAmount: bigint("fee_amount", { mode: "number" }).notNull(),
}, (t) => [index("idx_sline_settlement").on(t.settlementId)]);

// ───────── 공지 ─────────
export const notices = pgTable("notices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  roundId: uuid("round_id").references(() => rounds.id),
  mode: text("mode").$type<NoticeMode>().notNull().default("manual"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  targets: jsonb("targets").$type<NoticeTarget[]>().notNull(),
  channels: jsonb("channels").$type<NotificationChannel[]>().notNull(),
  lotCount: integer("lot_count").notNull().default(0),
  recipientCount: integer("recipient_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  sentBy: uuid("sent_by").references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_notice_tenant").on(t.tenantId, t.sentAt)]);

// ───────── 분쟁 / 재개찰 ─────────
export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  auctionId: uuid("auction_id").notNull().references(() => auctions.id),
  kind: text("kind").$type<"reauction" | "objection">().notNull(),
  raisedBy: uuid("raised_by").notNull().references(() => users.id),
  raisedRole: text("raised_role").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<DisputeStatus>().notNull().default("open"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_dispute_tenant_status").on(t.tenantId, t.status)]);

/** 노조 회차 알림 구독 */
export const roundSubscriptions = pgTable("round_subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_round_sub").on(t.roundId, t.userId)]);

/** Platform Admin 분쟁 조회 모드 세션 */
export const platformReadSessions = pgTable("platform_read_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: uuid("admin_user_id").notNull().references(() => users.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  reason: text("reason").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Vessel = typeof vessels.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Intake = typeof intakes.$inferSelect;
export type Auction = typeof auctions.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type Notice = typeof notices.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;
