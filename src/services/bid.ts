import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { auctions, bids, bidRevisions, rounds, memberships, users, intakes, vessels, fishSpecies, type BidStatus } from "@/db/schema";
import { withTenant } from "@/db/context";
import { audit } from "./audit";
import { notify } from "./notification";
import { verifyOtp } from "./auth";
import { stateError, validation, notFound, forbidden } from "@/lib/errors";
import { won, unitLabel } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/context";

/** 입찰 제출/수정 (밀봉). 서버 시각 기준 마감 엄격 적용 */
export async function placeBid(ctx: TenantContext, auctionId: string, input: { price: number; memo?: string | null; otp?: string | null }) {
  const tenant = ctx.tenant;
  if (!ctx.membershipId || ctx.role !== "broker") throw forbidden("중매인만 입찰할 수 있습니다");
  if (!Number.isInteger(input.price) || input.price <= 0) throw validation("입찰가는 1원 이상 정수");
  if (input.memo && input.memo.length > 50) throw validation("메모는 50자 이내");
  const ip = "n/a";

  const result = await withTenant(tenant.id, async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, ctx.membershipId!));
    if (!m || m.status !== "active") throw forbidden("활성 멤버십이 아닙니다");
    if (m.licenseStatus !== "active") throw forbidden("면허가 유효하지 않아 입찰할 수 없습니다");
    if (tenant.bidMfaRequired) {
      if (!input.otp) throw validation("입찰 인증번호가 필요합니다");
      if (!(await verifyOtp(`bid:${ctx.session.userId}`, "bid", input.otp))) throw validation("인증번호가 올바르지 않습니다");
    }
    const [row] = await tx.select({ a: auctions, r: rounds }).from(auctions).leftJoin(rounds, eq(rounds.id, auctions.roundId)).where(and(eq(auctions.tenantId, tenant.id), eq(auctions.id, auctionId))).for("update", { of: auctions });
    if (!row) throw notFound("경매 물품을 찾을 수 없습니다");
    const { a, r } = row;
    const now = new Date();
    const isRebid = a.status === "rebid";
    if (isRebid) {
      if (!a.rebidUntil || a.rebidUntil <= now) throw stateError("재입찰 시간이 종료되었습니다");
    } else {
      if (!["open", "closing"].includes(a.status)) throw stateError(a.status === "announced" ? "아직 입찰 시작 전입니다" : "마감된 경매입니다");
      if (!r || r.bidCloseAt <= now) throw stateError("마감된 경매입니다");
      if (r.bidStartAt > now) throw stateError("아직 입찰 시작 전입니다");
    }
    if (a.reservePrice && input.price < a.reservePrice) throw validation(`최저가(${won(a.reservePrice)}) 이상으로 입찰하세요`);

    const [existing] = await tx.select().from(bids).where(and(eq(bids.auctionId, a.id), eq(bids.brokerMembershipId, m.id))).limit(1);
    if (existing) {
      if (isRebid) {
        if (!existing.isRebid) throw forbidden("재입찰 대상자가 아닙니다");
        if (input.price < existing.price) throw validation("재입찰가는 기존 입찰가 이상이어야 합니다");
      } else if (!tenant.bidModificationAllowed) throw stateError("이 수협은 입찰 수정을 허용하지 않습니다 (1회 확정)");
      const rev = existing.revision + 1;
      await tx.insert(bidRevisions).values({ tenantId: tenant.id, bidId: existing.id, revision: existing.revision, price: existing.price, memo: existing.memo, submittedAt: existing.submittedAt, ip: existing.ip });
      const [b] = await tx.update(bids).set({ price: input.price, memo: input.memo ?? null, revision: rev, submittedAt: now, status: "submitted", ip }).where(eq(bids.id, existing.id)).returning();
      await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: "broker", action: isRebid ? "bid.rebid" : "bid.modify", targetType: "bid", targetId: b.id, before: { price: existing.price }, after: { price: b.price, revision: rev } }, tx);
      return { bid: b, modified: true, a };
    }
    if (isRebid) throw forbidden("재입찰 대상자가 아닙니다");
    const [b] = await tx.insert(bids).values({ tenantId: tenant.id, auctionId: a.id, brokerMembershipId: m.id, brokerUserId: ctx.session.userId, price: input.price, memo: input.memo ?? null, submittedAt: now, firstSubmittedAt: now, ip }).returning();
    await tx.update(auctions).set({ bidCount: sql`${auctions.bidCount} + 1` }).where(eq(auctions.id, a.id));
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: "broker", action: "bid.create", targetType: "bid", targetId: b.id, after: { auctionId: a.id, price: b.price } }, tx);
    return { bid: b, modified: false, a };
  });

  await notify({ tenantId: tenant.id, userIds: [ctx.session.userId], type: "bid_confirmed", title: `입찰 ${result.modified ? "수정" : "등록"} 완료 · ${result.a.auctionNo}`, body: `${won(result.bid.price)}/${unitLabel(result.a.unit)}`, link: `/t/${tenant.code}/broker/results`, mandatory: true });
  return result;
}

/** 중매인 본인 입찰 (경매 정보 포함) */
export async function myBids(ctx: TenantContext, opts: { status?: BidStatus[]; from?: Date; to?: Date } = {}) {
  if (!ctx.membershipId) return [];
  return withTenant(ctx.tenant.id, (tx) => {
    const conds = [eq(bids.tenantId, ctx.tenant.id), eq(bids.brokerMembershipId, ctx.membershipId!)];
    if (opts.status) conds.push(inArray(bids.status, opts.status));
    if (opts.from) conds.push(gte(bids.submittedAt, opts.from));
    if (opts.to) conds.push(lte(bids.submittedAt, opts.to));
    const winnerLicense = sql<string | null>`(select m.license_no from ${memberships} m where m.id = ${auctions.winnerMembershipId})`;
    const winnerName = sql<string | null>`(select u.name from ${memberships} m join ${users} u on u.id = m.user_id where m.id = ${auctions.winnerMembershipId})`;
    return tx.select({ bid: bids, auction: auctions, speciesName: fishSpecies.name, vesselName: vessels.name, shipperName: users.name, round: rounds, winnerLicense, winnerName })
      .from(bids).innerJoin(auctions, eq(auctions.id, bids.auctionId)).innerJoin(intakes, eq(intakes.id, auctions.intakeId)).innerJoin(vessels, eq(vessels.id, intakes.vesselId))
      .leftJoin(users, eq(users.id, vessels.shipperUserId)).leftJoin(rounds, eq(rounds.id, auctions.roundId)).leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(and(...conds)).orderBy(desc(bids.submittedAt));
  });
}

export async function myBidFor(ctx: TenantContext, auctionId: string) {
  if (!ctx.membershipId) return null;
  return withTenant(ctx.tenant.id, async (tx) => (await tx.select().from(bids).where(and(eq(bids.auctionId, auctionId), eq(bids.brokerMembershipId, ctx.membershipId!))).limit(1))[0] ?? null);
}

/** 운영자: 전체 입찰 내역 (감사용) */
export async function listAllBids(tenantId: string, opts: { roundId?: string; brokerMembershipId?: string; speciesCode?: string; status?: BidStatus[]; from?: Date; to?: Date; q?: string; limit?: number } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(bids.tenantId, tenantId)];
    if (opts.roundId) conds.push(eq(auctions.roundId, opts.roundId));
    if (opts.brokerMembershipId) conds.push(eq(bids.brokerMembershipId, opts.brokerMembershipId));
    if (opts.speciesCode) conds.push(eq(auctions.speciesCode, opts.speciesCode));
    if (opts.status) conds.push(inArray(bids.status, opts.status));
    if (opts.from) conds.push(gte(bids.submittedAt, opts.from));
    if (opts.to) conds.push(lte(bids.submittedAt, opts.to));
    if (opts.q) conds.push(sql`(${auctions.auctionNo} ilike ${"%" + opts.q + "%"} or ${users.name} ilike ${"%" + opts.q + "%"} or ${memberships.licenseNo} ilike ${"%" + opts.q + "%"})`);
    return tx.select({ bid: bids, auctionNo: auctions.auctionNo, auctionStatus: auctions.status, speciesCode: auctions.speciesCode, speciesName: fishSpecies.name, unit: auctions.unit, brokerName: users.name, licenseNo: memberships.licenseNo, roundLabel: rounds.label, finalPrice: auctions.finalPrice })
      .from(bids).innerJoin(auctions, eq(auctions.id, bids.auctionId)).innerJoin(memberships, eq(memberships.id, bids.brokerMembershipId)).innerJoin(users, eq(users.id, bids.brokerUserId))
      .leftJoin(rounds, eq(rounds.id, auctions.roundId)).leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(and(...conds)).orderBy(desc(bids.submittedAt)).limit(opts.limit ?? 500);
  });
}

/** 시세 추천: 최근 30일 동일 어종·단위 낙찰가 평균 */
export async function recentAveragePrice(tenantId: string, speciesCode: string, unit: string) {
  return withTenant(tenantId, async (tx) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [r] = await tx.select({ avg: sql<number | null>`avg(${auctions.finalPrice})::float`, n: sql<number>`count(*)::int` }).from(auctions)
      .where(and(eq(auctions.tenantId, tenantId), eq(auctions.speciesCode, speciesCode), eq(auctions.unit, unit as "kg"), inArray(auctions.status, ["awarded", "settled"]), gte(auctions.awardedAt, since)));
    return r?.avg ? { avg: Math.round(r.avg), n: r.n } : null;
  });
}

export async function bidsForAuction(tenantId: string, auctionId: string) {
  return withTenant(tenantId, (tx) => tx.select({ bid: bids, brokerName: users.name, licenseNo: memberships.licenseNo })
    .from(bids).innerJoin(memberships, eq(memberships.id, bids.brokerMembershipId)).innerJoin(users, eq(users.id, bids.brokerUserId))
    .where(and(eq(bids.tenantId, tenantId), eq(bids.auctionId, auctionId))).orderBy(desc(bids.price), asc(bids.firstSubmittedAt)));
}
