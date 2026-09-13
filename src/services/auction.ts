import "server-only";
import { outer } from "@/db/sql";
import { and, asc, desc, eq, inArray, notInArray, sql, ne } from "drizzle-orm";
import { auctions, bids, auctionResults, rounds, intakes, vessels, users, memberships, disputes, fishSpecies, type Tenant, type Auction, type AuctionStatus } from "@/db/schema";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/context";
import { audit } from "./audit";
import { notify, usersByRoles } from "./notification";
import { decideAward } from "@/domain/auction/award";
import { stateError, validation, notFound, forbidden } from "@/lib/errors";
import { won, unitLabel } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/context";

export const TERMINAL: AuctionStatus[] = ["awarded", "passed", "settled", "withdrawn"];

/** 회차/조건별 경매 물품 (운영자·중매인·노조 공용) */
export async function listAuctions(tenantId: string, opts: { roundId?: string; status?: AuctionStatus[]; intakeId?: string; shipperUserId?: string; speciesCode?: string; limit?: number; from?: Date } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(auctions.tenantId, tenantId), ne(auctions.status, "withdrawn")];
    if (opts.roundId) conds.push(eq(auctions.roundId, opts.roundId));
    if (opts.status) conds.push(inArray(auctions.status, opts.status));
    if (opts.intakeId) conds.push(eq(auctions.intakeId, opts.intakeId));
    if (opts.shipperUserId) conds.push(eq(vessels.shipperUserId, opts.shipperUserId));
    if (opts.speciesCode) conds.push(eq(auctions.speciesCode, opts.speciesCode));
    if (opts.from) conds.push(sql`${auctions.createdAt} >= ${opts.from}`);
    const winnerUser = sql<string | null>`(select u.name from ${memberships} m join ${users} u on u.id = m.user_id where m.id = ${outer(auctions, auctions.winnerMembershipId)})`;
    const winnerLicense = sql<string | null>`(select m.license_no from ${memberships} m where m.id = ${outer(auctions, auctions.winnerMembershipId)})`;
    return tx.select({
      auction: auctions, speciesName: fishSpecies.name, vesselName: vessels.name, shipperName: users.name, shipperUserId: vessels.shipperUserId,
      round: rounds, intakeStatus: intakes.status, winnerName: winnerUser, winnerLicense,
    }).from(auctions)
      .innerJoin(intakes, eq(intakes.id, auctions.intakeId))
      .innerJoin(vessels, eq(vessels.id, intakes.vesselId))
      .leftJoin(users, eq(users.id, vessels.shipperUserId))
      .leftJoin(rounds, eq(rounds.id, auctions.roundId))
      .leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(and(...conds)).orderBy(asc(auctions.auctionNo), asc(auctions.createdAt)).limit(opts.limit ?? 500);
  });
}
export type AuctionRow = Awaited<ReturnType<typeof listAuctions>>[number];

export async function getAuction(tenantId: string, auctionId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select({
      auction: auctions, speciesName: fishSpecies.name, vesselName: vessels.name, shipperName: users.name, shipperUserId: vessels.shipperUserId, round: rounds, intake: intakes,
    }).from(auctions).innerJoin(intakes, eq(intakes.id, auctions.intakeId)).innerJoin(vessels, eq(vessels.id, intakes.vesselId))
      .leftJoin(users, eq(users.id, vessels.shipperUserId)).leftJoin(rounds, eq(rounds.id, auctions.roundId)).leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(and(eq(auctions.tenantId, tenantId), eq(auctions.id, auctionId))).limit(1);
    if (!rows[0]) return null;
    const results = await tx.select().from(auctionResults).where(eq(auctionResults.auctionId, auctionId)).orderBy(desc(auctionResults.attempt));
    return { ...rows[0], results };
  });
}

/** 활성 중매인 (현장 낙찰자 선택용) */
export async function listActiveBrokers(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.select({ membershipId: memberships.id, userId: users.id, name: users.name, licenseNo: memberships.licenseNo, licenseStatus: memberships.licenseStatus })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "broker"), eq(memberships.status, "active"))).orderBy(asc(memberships.licenseNo)));
}

// ───────── 개찰 핵심 ─────────
interface AwardOpts { decidedBy: string | null; reason?: string | null; attempt?: number; onlyRebid?: boolean }

/** 트랜잭션 내 개찰. 상태 전이 + 결과 기록 + 입찰 상태 갱신. 알림은 반환값으로 호출자가 처리 */
export async function awardInTx(tx: Tx, tenant: Tenant, a: Auction, opts: AwardOpts) {
  const bidRows = await tx.select().from(bids).where(and(eq(bids.auctionId, a.id), inArray(bids.status, ["submitted", "closed"]), ...(opts.onlyRebid ? [eq(bids.isRebid, true)] : [])));
  const field = a.fieldHighPrice && a.fieldWinnerMembershipId ? { price: a.fieldHighPrice, membershipId: a.fieldWinnerMembershipId } : null;
  const tieBreak = opts.onlyRebid && tenant.tieBreakPolicy === "rebid" ? "first_come" : tenant.tieBreakPolicy;
  const d = decideAward({ bids: bidRows.map((b) => ({ bidId: b.id, membershipId: b.brokerMembershipId, price: b.price, firstSubmittedAt: b.firstSubmittedAt })), field, reservePrice: a.reservePrice, tieBreak });
  const attempt = opts.attempt ?? 1;
  await tx.update(auctionResults).set({ isCurrent: false }).where(eq(auctionResults.auctionId, a.id));

  if (d.outcome === "rebid") {
    const until = new Date(Date.now() + 5 * 60_000);
    const ids = d.candidates.map((c) => c.bidId);
    await tx.update(bids).set({ isRebid: true, status: "submitted" }).where(inArray(bids.id, ids));
    await tx.update(bids).set({ status: "closed" }).where(and(eq(bids.auctionId, a.id), notInArray(bids.id, ids)));
    await tx.update(auctions).set({ status: "rebid", rebidUntil: until, digitalHighPrice: d.digitalHigh }).where(eq(auctions.id, a.id));
    await tx.insert(auctionResults).values({ tenantId: tenant.id, auctionId: a.id, attempt, outcome: "rebid", finalPrice: d.finalPrice, digitalHighPrice: d.digitalHigh, fieldHighPrice: d.fieldHigh, source: "digital", tieBreak: "rebid", decidedBy: opts.decidedBy, reason: opts.reason ?? null });
    return { decision: d, rebidUntil: until, candidateMembershipIds: d.candidates.map((c) => c.membershipId) };
  }
  if (d.outcome === "passed") {
    await tx.update(bids).set({ status: "lost" }).where(and(eq(bids.auctionId, a.id), inArray(bids.status, ["submitted", "closed"])));
    await tx.update(auctions).set({ status: "passed", digitalHighPrice: d.digitalHigh, finalPrice: null, winnerMembershipId: null, awardSource: "none", awardedAt: new Date(), rebidUntil: null }).where(eq(auctions.id, a.id));
    await tx.insert(auctionResults).values({ tenantId: tenant.id, auctionId: a.id, attempt, outcome: "passed", digitalHighPrice: d.digitalHigh, fieldHighPrice: d.fieldHigh, source: "none", decidedBy: opts.decidedBy, reason: opts.reason ?? d.reason });
    return { decision: d };
  }
  if (d.outcome === "split") {
    const winIds = d.winners.map((w) => w.bidId);
    await tx.update(bids).set({ status: "awarded" }).where(inArray(bids.id, winIds));
    await tx.update(bids).set({ status: "lost" }).where(and(eq(bids.auctionId, a.id), notInArray(bids.id, winIds), inArray(bids.status, ["submitted", "closed"])));
    await tx.update(auctions).set({ status: "awarded", digitalHighPrice: d.digitalHigh, finalPrice: d.finalPrice, winnerMembershipId: d.winners[0].membershipId, awardSource: "digital", awardedAt: new Date(), rebidUntil: null }).where(eq(auctions.id, a.id));
    await tx.insert(auctionResults).values({ tenantId: tenant.id, auctionId: a.id, attempt, outcome: "split", finalPrice: d.finalPrice, digitalHighPrice: d.digitalHigh, fieldHighPrice: d.fieldHigh, source: "digital", winnerMembershipId: d.winners[0].membershipId, winners: d.winners.map((w) => ({ membershipId: w.membershipId, share: w.share })), tieBreak: "split", decidedBy: opts.decidedBy, reason: opts.reason ?? null });
    return { decision: d, winnerMembershipIds: d.winners.map((w) => w.membershipId) };
  }
  // awarded
  if (d.winnerBidId) {
    await tx.update(bids).set({ status: "awarded" }).where(eq(bids.id, d.winnerBidId));
    await tx.update(bids).set({ status: "lost" }).where(and(eq(bids.auctionId, a.id), ne(bids.id, d.winnerBidId), inArray(bids.status, ["submitted", "closed"])));
  } else {
    await tx.update(bids).set({ status: "lost" }).where(and(eq(bids.auctionId, a.id), inArray(bids.status, ["submitted", "closed"])));
  }
  await tx.update(auctions).set({ status: "awarded", digitalHighPrice: d.digitalHigh, finalPrice: d.finalPrice, winnerMembershipId: d.winnerMembershipId, awardSource: d.source, awardedAt: new Date(), rebidUntil: null }).where(eq(auctions.id, a.id));
  await tx.insert(auctionResults).values({ tenantId: tenant.id, auctionId: a.id, attempt, outcome: "awarded", finalPrice: d.finalPrice, digitalHighPrice: d.digitalHigh, fieldHighPrice: d.fieldHigh, source: d.source, winnerMembershipId: d.winnerMembershipId, tieBreak: d.tieBreak, decidedBy: opts.decidedBy, reason: opts.reason ?? null });
  return { decision: d, winnerMembershipIds: [d.winnerMembershipId] };
}

/** 개찰 결과 통보 (UC-05): 낙찰자·패찰자·선주 */
export async function notifyAwardResult(tenant: Tenant, auctionId: string) {
  const detail = await getAuction(tenant.id, auctionId);
  if (!detail) return;
  const a = detail.auction;
  const label = `${detail.speciesName ?? a.speciesCode} ${a.grade}등급 · ${a.auctionNo}`;
  const bidderRows = await withTenant(tenant.id, (tx) => tx.select({ userId: bids.brokerUserId, status: bids.status, membershipId: bids.brokerMembershipId }).from(bids).where(eq(bids.auctionId, auctionId)));
  const winners = bidderRows.filter((b) => b.status === "awarded").map((b) => b.userId);
  const losers = bidderRows.filter((b) => b.status === "lost").map((b) => b.userId);
  const link = `/t/${tenant.code}/broker/results`;
  if (a.status === "rebid") {
    const cands = bidderRows.filter((b) => b.status === "submitted").map((b) => b.userId);
    await notify({ tenantId: tenant.id, userIds: cands, type: "notice", title: `재입찰 요청 · ${label}`, body: `동일 최고가로 5분간 재입찰이 진행됩니다`, link: `/t/${tenant.code}/broker/bid/${a.id}`, channels: ["kakao"], mandatory: true });
    return;
  }
  if (a.status === "awarded") {
    const fieldWinnerUser = a.awardSource === "field" && a.winnerMembershipId
      ? (await withTenant(tenant.id, (tx) => tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, a.winnerMembershipId!))))[0]?.userId : null;
    const winUsers = fieldWinnerUser ? [fieldWinnerUser] : winners;
    await notify({ tenantId: tenant.id, userIds: winUsers, type: "awarded", title: `🎉 낙찰 · ${label}`, body: `${won(a.finalPrice)}/${unitLabel(a.unit)} (${a.awardSource === "field" ? "현장" : "디지털"})`, link, channels: ["kakao"], mandatory: true });
    await notify({ tenantId: tenant.id, userIds: losers.filter((u) => !winUsers.includes(u)), type: "lost", title: `패찰 · ${label}`, body: `낙찰가 ${won(a.finalPrice)}/${unitLabel(a.unit)}`, link });
    if (detail.shipperUserId) await notify({ tenantId: tenant.id, userIds: [detail.shipperUserId], type: "awarded", title: `낙찰 · ${detail.vesselName} ${label}`, body: `${won(a.finalPrice)}/${unitLabel(a.unit)} × ${a.quantity}${unitLabel(a.unit)}`, link: `/t/${tenant.code}/shipper/intake/${a.intakeId}`, channels: ["kakao"], mandatory: true });
  } else if (a.status === "passed") {
    await notify({ tenantId: tenant.id, userIds: losers, type: "passed", title: `유찰 · ${label}`, body: a.reservePrice ? `최저가(${won(a.reservePrice)}) 미달` : "입찰 없음", link });
    if (detail.shipperUserId) await notify({ tenantId: tenant.id, userIds: [detail.shipperUserId], type: "passed", title: `유찰 · ${detail.vesselName} ${label}`, body: a.reservePrice ? `최저가 미달로 유찰되었습니다` : "입찰이 없어 유찰되었습니다", link: `/t/${tenant.code}/shipper/intake/${a.intakeId}`, mandatory: true });
  }
}

/** 운영자 수동 개찰 (행 단위). closed_digital / field_open / rebid 상태에서 가능 */
export async function openAuction(ctx: TenantContext, auctionId: string, opts: { withoutField?: boolean } = {}) {
  const tenant = ctx.tenant;
  await withTenant(tenant.id, async (tx) => {
    const [a] = await tx.select().from(auctions).where(and(eq(auctions.tenantId, tenant.id), eq(auctions.id, auctionId))).for("update");
    if (!a) throw notFound("경매 물품을 찾을 수 없습니다");
    if (!["closed_digital", "field_open", "rebid"].includes(a.status)) throw stateError(`현재 상태(${a.status})에서는 개찰할 수 없습니다`);
    if (tenant.fieldAuctionEnabled && a.status !== "rebid" && !a.fieldHighPrice && !opts.withoutField) throw stateError("현장 결과가 입력되지 않았습니다. 현장 결과 입력 후 개찰하거나 '디지털만으로 개찰'을 선택하세요");
    const attempt = ((await tx.select({ m: sql<number>`coalesce(max(attempt),0)::int` }).from(auctionResults).where(eq(auctionResults.auctionId, a.id)))[0].m) + 1;
    await awardInTx(tx, tenant, a, { decidedBy: ctx.session.userId, attempt, onlyRebid: a.status === "rebid" });
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "auction.open", targetType: "auction", targetId: a.id, before: { status: a.status }, after: { manual: true, withoutField: !!opts.withoutField } }, tx);
  });
  await notifyAwardResult(tenant, auctionId);
  await maybeFinishRound(tenant.id, auctionId);
}

export async function openAllClosed(ctx: TenantContext, roundId: string) {
  const list = await withTenant(ctx.tenant.id, (tx) => tx.select({ id: auctions.id }).from(auctions).where(and(eq(auctions.tenantId, ctx.tenant.id), eq(auctions.roundId, roundId), inArray(auctions.status, ["closed_digital", "field_open"]))));
  let n = 0;
  for (const { id } of list) { await openAuction(ctx, id, { withoutField: true }); n++; }
  return n;
}

/** 현장 호가식 결과 입력 (Phase 2). 입력 즉시 비교·개찰 */
export async function enterFieldResult(ctx: TenantContext, auctionId: string, input: { price: number; winnerMembershipId: string; note?: string | null }) {
  const tenant = ctx.tenant;
  if (!(input.price > 0)) throw validation("현장 최고가는 0보다 커야 합니다");
  await withTenant(tenant.id, async (tx) => {
    const [a] = await tx.select().from(auctions).where(and(eq(auctions.tenantId, tenant.id), eq(auctions.id, auctionId))).for("update");
    if (!a) throw notFound();
    if (!["closed_digital", "field_open"].includes(a.status)) throw stateError("디지털 마감 후에만 현장 결과를 입력할 수 있습니다");
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.id, input.winnerMembershipId), eq(memberships.tenantId, tenant.id), eq(memberships.role, "broker"), eq(memberships.status, "active")));
    if (!m) throw validation("유효한 중매인이 아닙니다");
    const [updated] = await tx.update(auctions).set({ fieldHighPrice: input.price, fieldWinnerMembershipId: input.winnerMembershipId, fieldNote: input.note ?? null, fieldEnteredBy: ctx.session.userId, fieldEnteredAt: new Date() }).where(eq(auctions.id, a.id)).returning();
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "auction.field_result", targetType: "auction", targetId: a.id, before: { fieldHighPrice: a.fieldHighPrice, fieldWinnerMembershipId: a.fieldWinnerMembershipId }, after: { fieldHighPrice: input.price, fieldWinnerMembershipId: input.winnerMembershipId, note: input.note } }, tx);
    const attempt = ((await tx.select({ m: sql<number>`coalesce(max(attempt),0)::int` }).from(auctionResults).where(eq(auctionResults.auctionId, a.id)))[0].m) + 1;
    await awardInTx(tx, tenant, updated, { decidedBy: ctx.session.userId, attempt });
  });
  await notifyAwardResult(tenant, auctionId);
  await maybeFinishRound(tenant.id, auctionId);
  return getAuction(tenant.id, auctionId);
}

/** 회차의 모든 물품이 종결되면 회차 done */
export async function maybeFinishRound(tenantId: string, auctionId: string) {
  const [a] = await withTenant(tenantId, (tx) => tx.select({ roundId: auctions.roundId }).from(auctions).where(and(eq(auctions.tenantId, tenantId), eq(auctions.id, auctionId))));
  if (a?.roundId) await finishRoundIfDone(tenantId, a.roundId);
}

/** 회차의 모든 물품이 종결 상태이면 회차 done */
export async function finishRoundIfDone(tenantId: string, roundId: string) {
  await withTenant(tenantId, async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.roundId, roundId), sql`${auctions.status} not in ('awarded','passed','settled','withdrawn','disputed')`));
    if (n === 0) await tx.update(rounds).set({ status: "done" }).where(and(eq(rounds.id, roundId), ne(rounds.status, "cancelled")));
  });
}

// ───────── 분쟁 / 재개찰 ─────────
export async function requestReauction(ctx: TenantContext, auctionId: string, reason: string) {
  if (reason.trim().length < 5) throw validation("사유를 5자 이상 입력하세요");
  const tenant = ctx.tenant;
  const admins = await usersByRoles(tenant.id, ["admin"]);
  const d = await withTenant(tenant.id, async (tx) => {
    const [a] = await tx.select().from(auctions).where(and(eq(auctions.tenantId, tenant.id), eq(auctions.id, auctionId))).for("update");
    if (!a) throw notFound();
    if (!["awarded", "passed"].includes(a.status)) throw stateError("낙찰/유찰 상태에서만 재개찰을 신청할 수 있습니다");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(disputes).where(and(eq(disputes.auctionId, a.id), eq(disputes.kind, "reauction"), eq(disputes.status, "approved")));
    if (n >= 1) throw stateError("재개찰은 회차당 1회만 가능합니다");
    const [d] = await tx.insert(disputes).values({ tenantId: tenant.id, auctionId: a.id, kind: "reauction", raisedBy: ctx.session.userId, raisedRole: ctx.role ?? "operator", reason: reason.trim() }).returning();
    await tx.update(auctions).set({ status: "disputed" }).where(eq(auctions.id, a.id));
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "auction.reauction_request", targetType: "auction", targetId: a.id, reason, after: d }, tx);
    return { d, auctionNo: a.auctionNo };
  });
  await notify({ tenantId: tenant.id, userIds: admins, type: "dispute", title: `재개찰 승인 요청 · ${d.auctionNo}`, body: reason, link: `/t/${tenant.code}/admin?tab=disputes`, channels: ["kakao"] });
  return d.d;
}

/** 선주 이의 제기 */
export async function raiseObjection(ctx: TenantContext, auctionId: string, reason: string) {
  if (reason.trim().length < 5) throw validation("사유를 5자 이상 입력하세요");
  const tenant = ctx.tenant;
  const ops = await usersByRoles(tenant.id, ["operator", "admin"]);
  const res = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx.select({ a: auctions, shipperUserId: vessels.shipperUserId }).from(auctions).innerJoin(intakes, eq(intakes.id, auctions.intakeId)).innerJoin(vessels, eq(vessels.id, intakes.vesselId)).where(and(eq(auctions.tenantId, tenant.id), eq(auctions.id, auctionId)));
    if (!row) throw notFound();
    if (row.shipperUserId !== ctx.session.userId) throw forbidden("본인 물품에만 이의를 제기할 수 있습니다");
    if (!["awarded", "passed"].includes(row.a.status)) throw stateError("낙찰/유찰 이후에만 이의 제기가 가능합니다");
    if (row.a.awardedAt && Date.now() - row.a.awardedAt.getTime() > 24 * 3600_000) throw stateError("이의 제기는 낙찰 후 24시간 이내에만 가능합니다");
    const [d] = await tx.insert(disputes).values({ tenantId: tenant.id, auctionId, kind: "objection", raisedBy: ctx.session.userId, raisedRole: "shipper", reason: reason.trim() }).returning();
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: "shipper", action: "dispute.objection", targetType: "auction", targetId: auctionId, reason }, tx);
    return { d, auctionNo: row.a.auctionNo };
  });
  await notify({ tenantId: tenant.id, userIds: ops, type: "dispute", title: `선주 이의 제기 · ${res.auctionNo}`, body: reason, link: `/t/${tenant.code}/operator/results` });
  return res.d;
}

export async function listDisputes(tenantId: string, opts: { status?: ("open" | "approved" | "rejected" | "resolved")[]; raisedBy?: string } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(disputes.tenantId, tenantId)];
    if (opts.status) conds.push(inArray(disputes.status, opts.status));
    if (opts.raisedBy) conds.push(eq(disputes.raisedBy, opts.raisedBy));
    return tx.select({ dispute: disputes, auctionNo: auctions.auctionNo, auctionStatus: auctions.status, speciesCode: auctions.speciesCode, raisedByName: users.name, finalPrice: auctions.finalPrice })
      .from(disputes).innerJoin(auctions, eq(auctions.id, disputes.auctionId)).innerJoin(users, eq(users.id, disputes.raisedBy))
      .where(and(...conds)).orderBy(desc(disputes.createdAt));
  });
}

/** Admin 승인/거부. 승인 시 결과 무효화 → closed_digital 로 되돌려 재개찰 대기 */
export async function decideDispute(ctx: TenantContext, disputeId: string, approve: boolean, note?: string) {
  const tenant = ctx.tenant;
  const r = await withTenant(tenant.id, async (tx) => {
    const [d] = await tx.select().from(disputes).where(and(eq(disputes.tenantId, tenant.id), eq(disputes.id, disputeId))).for("update");
    if (!d) throw notFound();
    if (d.status !== "open") throw stateError("이미 처리된 건입니다");
    const [a] = await tx.select().from(auctions).where(eq(auctions.id, d.auctionId)).for("update");
    await tx.update(disputes).set({ status: approve ? "approved" : "rejected", decidedBy: ctx.session.userId, decisionNote: note ?? null, decidedAt: new Date() }).where(eq(disputes.id, d.id));
    if (d.kind === "reauction") {
      if (approve) {
        if (a.status === "settled") throw stateError("정산 확정된 물품은 재개찰할 수 없습니다");
        await tx.update(auctionResults).set({ isCurrent: false }).where(eq(auctionResults.auctionId, a.id));
        await tx.update(bids).set({ status: "closed", isRebid: false }).where(and(eq(bids.auctionId, a.id), inArray(bids.status, ["awarded", "lost", "submitted"])));
        await tx.update(auctions).set({ status: "closed_digital", finalPrice: null, winnerMembershipId: null, awardSource: null, awardedAt: null, fieldHighPrice: null, fieldWinnerMembershipId: null, fieldNote: null, rebidUntil: null }).where(eq(auctions.id, a.id));
        await tx.update(rounds).set({ status: "auctioning" }).where(and(eq(rounds.id, a.roundId!), eq(rounds.status, "done")));
      } else {
        await tx.update(auctions).set({ status: a.finalPrice != null ? "awarded" : "passed" }).where(eq(auctions.id, a.id));
      }
    } else if (approve) {
      // 이의 제기 승인 → 운영자가 재개찰 신청하도록 안내 (상태 유지)
    }
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: approve ? "dispute.approve" : "dispute.reject", targetType: "dispute", targetId: d.id, before: d, after: { note }, reason: note }, tx);
    return { d, a };
  });
  const bidderUsers = await withTenant(tenant.id, (tx) => tx.select({ userId: bids.brokerUserId }).from(bids).where(eq(bids.auctionId, r.a.id)));
  const targets = [r.d.raisedBy, ...bidderUsers.map((b) => b.userId)];
  await notify({ tenantId: tenant.id, userIds: targets, type: "dispute", title: `${r.d.kind === "reauction" ? "재개찰" : "이의 제기"} ${approve ? "승인" : "거부"} · ${r.a.auctionNo}`, body: note ?? (approve ? "재개찰이 진행됩니다" : "기존 결과가 유지됩니다"), link: `/t/${tenant.code}` });
  return r.d;
}
