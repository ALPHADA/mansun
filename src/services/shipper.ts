import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withTenant } from "@/db/context";
import { users, memberships, intakes, auctions, type NotificationPrefs, type Auction } from "@/db/schema";
import { listIntakes, getIntake } from "./intake";
import { listAuctions, listDisputes, type AuctionRow } from "./auction";
import { listSettlements } from "./settlement";
import { listVessels } from "./vessel";
import { audit } from "./audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { conflict, notFound, validation, stateError } from "@/lib/errors";
import { localDateStr } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/context";

const ACTOR_ROLE = "shipper";
const kstDayStart = (dateStr: string) => new Date(`${dateStr}T00:00:00+09:00`);

/** 로트 1건의 선주 지급액 미리보기 = 낙찰가 × 수량 − 위판수수료 */
export function lotPayout(a: Pick<Auction, "finalPrice" | "quantity" | "status">, marketFeeRate: number) {
  if (a.finalPrice == null || !["awarded", "settled", "disputed"].includes(a.status)) return null;
  const gross = Math.round(a.finalPrice * a.quantity);
  const fee = Math.round(gross * marketFeeRate);
  return { gross, fee, net: gross - fee };
}

// ───────── 출하 메인 ─────────
export async function myShipmentsToday(ctx: TenantContext) {
  const me = ctx.session.userId;
  const today = localDateStr();
  const [todayIntakes, recentIntakes, lots] = await Promise.all([
    listIntakes(ctx.tenant.id, { shipperUserId: me, date: today }),
    listIntakes(ctx.tenant.id, { shipperUserId: me, from: new Date(Date.now() - 7 * 86_400_000), limit: 50 }),
    listAuctions(ctx.tenant.id, { shipperUserId: me, limit: 1000 }),
  ]);
  const todayIds = new Set(todayIntakes.map((i) => i.id));
  const todayLots = lots.filter((l) => todayIds.has(l.auction.intakeId));
  const rate = ctx.tenant.feePolicy.marketFeeRate;
  const expectedPay = todayLots.reduce((s, l) => s + (lotPayout(l.auction, rate)?.net ?? 0), 0);
  const lotsByIntake = new Map<string, AuctionRow[]>();
  for (const l of lots) lotsByIntake.set(l.auction.intakeId, [...(lotsByIntake.get(l.auction.intakeId) ?? []), l]);
  const decorate = (i: (typeof todayIntakes)[number]) => {
    const ls = lotsByIntake.get(i.id) ?? [];
    const species = [...new Set(ls.map((l) => l.speciesName ?? l.auction.speciesCode))];
    const awarded = ls.filter((l) => ["awarded", "settled", "disputed"].includes(l.auction.status)).length;
    return { ...i, species, lotStatuses: ls.map((l) => l.auction.status), awarded, expectedPay: ls.reduce((s, l) => s + (lotPayout(l.auction, rate)?.net ?? 0), 0) };
  };
  return {
    kpi: { count: todayIntakes.length, weightKg: todayIntakes.reduce((s, i) => s + i.totalWeight, 0), lots: todayLots.length, expectedPay, awardedLots: todayLots.filter((l) => ["awarded", "settled"].includes(l.auction.status)).length },
    today: todayIntakes.map(decorate),
    recent: recentIntakes.filter((i) => !todayIds.has(i.id)).map(decorate),
    week: { count: recentIntakes.length, weightKg: recentIntakes.reduce((s, i) => s + i.totalWeight, 0) },
  };
}

/** 기간·어종별 본인 출하 목록 */
export async function myIntakes(ctx: TenantContext, opts: { from?: string; to?: string; species?: string } = {}) {
  const me = ctx.session.userId;
  const from = opts.from ? kstDayStart(opts.from) : undefined;
  const to = opts.to ? new Date(kstDayStart(opts.to).getTime() + 86_400_000) : undefined;
  const rows = await listIntakes(ctx.tenant.id, { shipperUserId: me, from, to, limit: 500 });
  if (!opts.species) return rows;
  const lots = await listAuctions(ctx.tenant.id, { shipperUserId: me, speciesCode: opts.species, limit: 2000 });
  const ok = new Set(lots.map((l) => l.auction.intakeId));
  return rows.filter((r) => ok.has(r.id));
}

// ───────── 출하 상세 ─────────
export async function myIntakeDetail(ctx: TenantContext, intakeId: string) {
  const me = ctx.session.userId;
  const detail = await getIntake(ctx.tenant.id, intakeId);
  if (!detail || detail.shipperUserId !== me) throw notFound("출하 내역을 찾을 수 없습니다");
  const [lots, disputes] = await Promise.all([
    listAuctions(ctx.tenant.id, { intakeId }),
    listDisputes(ctx.tenant.id, { raisedBy: me }),
  ]);
  const lotIds = new Set(lots.map((l) => l.auction.id));
  const myDisputes = disputes.filter((d) => lotIds.has(d.dispute.auctionId));
  const openByAuction = new Set(myDisputes.filter((d) => d.dispute.status === "open").map((d) => d.dispute.auctionId));
  const rate = ctx.tenant.feePolicy.marketFeeRate;
  const anonymous = ctx.tenant.winnerDisclosure === "anonymous";
  const now = Date.now();
  const items = lots.map((l) => {
    const a = l.auction;
    const payout = lotPayout(a, rate);
    const within24h = !!a.awardedAt && now - a.awardedAt.getTime() <= 24 * 3600_000;
    const canObject = !ctx.readOnly && ["awarded", "passed"].includes(a.status) && within24h && !openByAuction.has(a.id);
    const winnerLabel = a.status === "awarded" || a.status === "settled" || a.status === "disputed"
      ? (anonymous ? "비공개" : (l.winnerLicense ?? "-")) : null;
    return { ...l, payout, canObject, winnerLabel, objectionDeadline: a.awardedAt ? new Date(a.awardedAt.getTime() + 24 * 3600_000) : null };
  });
  const totals = items.reduce((s, i) => ({ gross: s.gross + (i.payout?.gross ?? 0), fee: s.fee + (i.payout?.fee ?? 0), net: s.net + (i.payout?.net ?? 0) }), { gross: 0, fee: 0, net: 0 });
  const photos = items.flatMap((i) => i.auction.photos.map((p) => ({ url: p, lot: i.speciesName ?? i.auction.speciesCode })));
  return { ...detail, items, disputes: myDisputes, totals, photos, marketFeeRate: rate };
}
export type MyIntakeDetail = Awaited<ReturnType<typeof myIntakeDetail>>;

// ───────── 선박 ─────────
export async function myVessels(ctx: TenantContext) {
  const me = ctx.session.userId;
  const vs = await listVessels(ctx.tenant.id, { shipperUserId: me, includeInactive: true });
  if (vs.length === 0) return [];
  const ids = vs.map((v) => v.id);
  const stats = await withTenant(ctx.tenant.id, (tx) => tx.select({
    vesselId: intakes.vesselId,
    intakeCount: sql<number>`count(distinct ${intakes.id})::int`,
    lotCount: sql<number>`count(${auctions.id}) filter (where ${auctions.status} <> 'withdrawn')::int`,
    weightKg: sql<number>`coalesce(sum(${auctions.weightKg}) filter (where ${auctions.status} <> 'withdrawn'), 0)::float`,
    lastArrivedAt: sql<Date | null>`max(${intakes.arrivedAt})`,
    awardedAmount: sql<number>`coalesce(sum(case when ${auctions.status} in ('awarded','settled') then ${auctions.finalPrice} * ${auctions.quantity} else 0 end), 0)::float`,
  }).from(intakes).leftJoin(auctions, eq(auctions.intakeId, intakes.id))
    .where(and(eq(intakes.tenantId, ctx.tenant.id), inArray(intakes.vesselId, ids), sql`${intakes.status} <> 'deleted'`)).groupBy(intakes.vesselId));
  const byVessel = new Map(stats.map((s) => [s.vesselId, s]));
  return vs.map((v) => {
    const s = byVessel.get(v.id);
    const last = s?.lastArrivedAt ? new Date(s.lastArrivedAt) : null;
    return { ...v, intakeCount: s?.intakeCount ?? 0, lotCount: s?.lotCount ?? 0, weightKg: s?.weightKg ?? 0, lastArrivedAt: last, awardedAmount: Math.round(s?.awardedAmount ?? 0) };
  });
}

/** 선박별 최근 출하 (선박 카드 펼침용) */
export async function vesselRecentIntakes(ctx: TenantContext, vesselId: string, limit = 10) {
  const rows = await listIntakes(ctx.tenant.id, { shipperUserId: ctx.session.userId, vesselId, limit });
  return rows;
}

// ───────── 정산 ─────────
export async function mySettlements(ctx: TenantContext, opts: { from?: string; to?: string } = {}) {
  const rows = await listSettlements(ctx.tenant.id, { partyType: "shipper", partyUserId: ctx.session.userId });
  const filtered = rows.filter((r) => (!opts.from || r.roundDate >= opts.from) && (!opts.to || r.roundDate <= opts.to));
  const summary = filtered.reduce((s, r) => ({ gross: s.gross + r.s.grossAmount, fee: s.fee + r.s.feeAmount, vat: s.vat + r.s.vatAmount, net: s.net + r.s.netAmount, lots: s.lots + r.s.lotCount }), { gross: 0, fee: 0, vat: 0, net: 0, lots: 0 });
  return { rows: filtered, summary };
}

// ───────── 마이페이지 ─────────
export async function myProfile(ctx: TenantContext) {
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, bankAccount: users.bankAccount, identityVerified: users.identityVerified, lastLoginAt: users.lastLoginAt, hasPassword: sql<boolean>`${users.passwordHash} is not null` })
    .from(users).where(eq(users.id, ctx.session.userId)).limit(1);
  if (!u) throw notFound("사용자를 찾을 수 없습니다");
  const [m] = ctx.membershipId
    ? await db.select({ prefs: memberships.notificationPrefs, joinedAt: memberships.joinedAt }).from(memberships).where(eq(memberships.id, ctx.membershipId)).limit(1)
    : await db.select({ prefs: memberships.notificationPrefs, joinedAt: memberships.joinedAt }).from(memberships)
      .where(and(eq(memberships.userId, ctx.session.userId), eq(memberships.tenantId, ctx.tenant.id), eq(memberships.role, "shipper"))).limit(1);
  return { user: u, prefs: m?.prefs ?? { inapp: true, kakao: true, sms: false, email: true, lostBidInapp: true }, joinedAt: m?.joinedAt ?? null };
}

export async function updateMyProfile(ctx: TenantContext, input: { phone?: string | null; bankAccount?: string | null }) {
  const me = ctx.session.userId;
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.phone !== undefined) {
    const phone = (input.phone ?? "").replace(/[^0-9]/g, "");
    if (phone && !/^\d{10,11}$/.test(phone)) throw validation("전화번호는 숫자 10~11자리");
    if (phone) {
      const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      if (dup && dup.id !== me) throw conflict("이미 등록된 전화번호입니다");
    }
    patch.phone = phone || null;
  }
  if (input.bankAccount !== undefined) {
    const acct = (input.bankAccount ?? "").trim();
    if (acct.length > 60) throw validation("입금 계좌는 60자 이내");
    patch.bankAccount = acct || null;
  }
  if (Object.keys(patch).length === 0) throw validation("변경할 항목이 없습니다");
  const [before] = await db.select({ phone: users.phone, bankAccount: users.bankAccount }).from(users).where(eq(users.id, me)).limit(1);
  const [after] = await db.update(users).set(patch).where(eq(users.id, me)).returning({ phone: users.phone, bankAccount: users.bankAccount });
  await audit({ tenantId: ctx.tenant.id, actorUserId: me, actorRole: ACTOR_ROLE, action: "user.update_profile", targetType: "user", targetId: me, before, after });
  return after;
}

/** 알림 채널 설정 — 낙찰·유찰·이의제기 결과는 mandatory 로 발송되어 옵트아웃 불가 (notify 의 mandatory 플래그) */
export async function updateMyNotificationPrefs(ctx: TenantContext, prefs: Partial<NotificationPrefs>) {
  const me = ctx.session.userId;
  const [m] = await db.select({ id: memberships.id, prefs: memberships.notificationPrefs }).from(memberships)
    .where(and(eq(memberships.userId, me), eq(memberships.tenantId, ctx.tenant.id), eq(memberships.role, "shipper"), eq(memberships.status, "active"))).limit(1);
  if (!m) throw stateError("선주 소속 정보를 찾을 수 없습니다");
  const next: NotificationPrefs = { ...m.prefs, ...Object.fromEntries(Object.entries(prefs).filter(([, v]) => typeof v === "boolean")) };
  await db.update(memberships).set({ notificationPrefs: next }).where(eq(memberships.id, m.id));
  await audit({ tenantId: ctx.tenant.id, actorUserId: me, actorRole: ACTOR_ROLE, action: "membership.update_prefs", targetType: "membership", targetId: m.id, before: m.prefs, after: next });
  return next;
}

export async function changeMyPassword(ctx: TenantContext, current: string, next: string) {
  const me = ctx.session.userId;
  if (next.length < 8) throw validation("새 비밀번호는 8자 이상");
  if (current === next) throw validation("현재 비밀번호와 다른 비밀번호를 입력하세요");
  const [u] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, me)).limit(1);
  if (!u) throw notFound();
  if (u.passwordHash && !(await verifyPassword(current, u.passwordHash))) throw validation("현재 비밀번호가 올바르지 않습니다");
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, me));
  await audit({ tenantId: ctx.tenant.id, actorUserId: me, actorRole: ACTOR_ROLE, action: "auth.password_change", targetType: "user", targetId: me });
}

/** 본인 로트 최근 N건 (CSV 등) */
export async function myLots(ctx: TenantContext, opts: { from?: string; to?: string } = {}) {
  const rows = await listAuctions(ctx.tenant.id, { shipperUserId: ctx.session.userId, limit: 2000 });
  return rows.filter((r) => {
    const d = r.round?.date;
    if (!d) return true;
    return (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to);
  }).sort((a, b) => (b.round?.date ?? "").localeCompare(a.round?.date ?? "") || (a.auction.auctionNo ?? "").localeCompare(b.auction.auctionNo ?? ""));
}

export const recentDisputes = (ctx: TenantContext) => listDisputes(ctx.tenant.id, { raisedBy: ctx.session.userId }).then((r) => r.sort((a, b) => b.dispute.createdAt.getTime() - a.dispute.createdAt.getTime()));
