import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { auctions, auctionResults, intakes, vessels, memberships, users, rounds, settlements, settlementLines, fishSpecies, type Tenant, type SettlementStatus } from "@/db/schema";
import { withTenant } from "@/db/context";
import { audit } from "./audit";
import { notify } from "./notification";
import { calcParty, type LotForSettlement } from "@/domain/settlement/calc";
import { makeSettlementNo } from "@/domain/auction/award";
import { getAccountingAdapter } from "@/adapters/accounting";
import { stateError, notFound } from "@/lib/errors";
import { won } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/context";

/** 회차 정산 생성/재계산 (pending 만 갱신, confirmed 는 불변) */
export async function generateSettlements(ctx: TenantContext, roundId: string) {
  const tenant = ctx.tenant;
  return withTenant(tenant.id, async (tx) => {
    const [round] = await tx.select().from(rounds).where(and(eq(rounds.tenantId, tenant.id), eq(rounds.id, roundId))).for("update");
    if (!round) throw notFound("회차를 찾을 수 없습니다");
    const lots = await tx.select({ a: auctions, shipperUserId: vessels.shipperUserId })
      .from(auctions).innerJoin(intakes, eq(intakes.id, auctions.intakeId)).innerJoin(vessels, eq(vessels.id, intakes.vesselId))
      .where(and(eq(auctions.roundId, roundId), inArray(auctions.status, ["awarded"])));
    const results = lots.length ? await tx.select().from(auctionResults).where(and(inArray(auctionResults.auctionId, lots.map((l) => l.a.id)), eq(auctionResults.isCurrent, true))) : [];
    const resByAuction = new Map(results.map((r) => [r.auctionId, r]));

    const shipperLots = new Map<string, LotForSettlement[]>();
    const brokerLots = new Map<string, LotForSettlement[]>(); // key membershipId
    for (const { a, shipperUserId } of lots) {
      if (!a.finalPrice || !shipperUserId) continue;
      const base: LotForSettlement = { auctionId: a.id, unitPrice: a.finalPrice, quantity: a.quantity, unit: a.unit };
      shipperLots.set(shipperUserId, [...(shipperLots.get(shipperUserId) ?? []), base]);
      const res = resByAuction.get(a.id);
      if (res?.outcome === "split" && res.winners) {
        for (const w of res.winners) brokerLots.set(w.membershipId, [...(brokerLots.get(w.membershipId) ?? []), { ...base, quantity: a.quantity * w.share }]);
      } else if (a.winnerMembershipId) {
        brokerLots.set(a.winnerMembershipId, [...(brokerLots.get(a.winnerMembershipId) ?? []), base]);
      }
    }
    const existing = await tx.select().from(settlements).where(eq(settlements.roundId, roundId));
    const confirmedKeys = new Set(existing.filter((s) => s.status !== "pending").map((s) => `${s.partyType}:${s.partyUserId}`));
    // pending 삭제 후 재생성
    const pendingIds = existing.filter((s) => s.status === "pending").map((s) => s.id);
    if (pendingIds.length) { await tx.delete(settlementLines).where(inArray(settlementLines.settlementId, pendingIds)); await tx.delete(settlements).where(inArray(settlements.id, pendingIds)); }

    const yyyymm = round.date.slice(0, 7).replace("-", "");
    let [{ seq }] = await tx.select({ seq: sql<number>`count(*)::int` }).from(settlements).where(and(eq(settlements.tenantId, tenant.id), sql`${settlements.settlementNo} like ${`${tenant.code}-S-${yyyymm}-%`}`));
    const created: string[] = [];
    const insertOne = async (partyType: "shipper" | "broker", partyUserId: string, partyMembershipId: string | null, lotList: LotForSettlement[]) => {
      if (confirmedKeys.has(`${partyType}:${partyUserId}`)) return;
      const c = calcParty(lotList, tenant.feePolicy, partyType);
      seq += 1;
      const [s] = await tx.insert(settlements).values({
        tenantId: tenant.id, roundId, settlementNo: makeSettlementNo(tenant.code, yyyymm, seq), partyType, partyUserId, partyMembershipId,
        lotCount: c.lotCount, grossAmount: c.grossAmount, feeAmount: c.feeAmount, vatAmount: c.vatAmount, netAmount: c.netAmount, feeRate: c.feeRate,
      }).returning();
      if (c.lines.length) await tx.insert(settlementLines).values(c.lines.map((l) => ({ tenantId: tenant.id, settlementId: s.id, ...l })));
      created.push(s.id);
    };
    for (const [uid, l] of shipperLots) await insertOne("shipper", uid, null, l);
    for (const [mid, l] of brokerLots) {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, mid));
      if (m) await insertOne("broker", m.userId, mid, l);
    }
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "settlement.generate", targetType: "round", targetId: roundId, after: { created: created.length } }, tx);
    return created.length;
  });
}

export async function listSettlements(tenantId: string, opts: { roundId?: string; partyType?: "shipper" | "broker"; partyUserId?: string; status?: SettlementStatus[]; limit?: number } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(settlements.tenantId, tenantId)];
    if (opts.roundId) conds.push(eq(settlements.roundId, opts.roundId));
    if (opts.partyType) conds.push(eq(settlements.partyType, opts.partyType));
    if (opts.partyUserId) conds.push(eq(settlements.partyUserId, opts.partyUserId));
    if (opts.status) conds.push(inArray(settlements.status, opts.status));
    const vesselNames = sql<string | null>`(select string_agg(distinct v.name, ', ') from ${settlementLines} sl join ${auctions} a on a.id = sl.auction_id join ${intakes} i on i.id = a.intake_id join ${vessels} v on v.id = i.vessel_id where sl.settlement_id = ${settlements.id})`;
    return tx.select({ s: settlements, partyName: users.name, licenseNo: memberships.licenseNo, roundLabel: rounds.label, roundDate: rounds.date, vesselNames, bankAccount: users.bankAccount })
      .from(settlements).innerJoin(users, eq(users.id, settlements.partyUserId)).leftJoin(memberships, eq(memberships.id, settlements.partyMembershipId)).innerJoin(rounds, eq(rounds.id, settlements.roundId))
      .where(and(...conds)).orderBy(desc(rounds.date), asc(settlements.partyType), asc(users.name)).limit(opts.limit ?? 500);
  });
}

export async function getSettlement(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ s: settlements, partyName: users.name, partyPhone: users.phone, bankAccount: users.bankAccount, licenseNo: memberships.licenseNo, round: rounds, confirmedByName: sql<string | null>`(select name from ${users} u where u.id = ${settlements.confirmedBy})` })
      .from(settlements).innerJoin(users, eq(users.id, settlements.partyUserId)).leftJoin(memberships, eq(memberships.id, settlements.partyMembershipId)).innerJoin(rounds, eq(rounds.id, settlements.roundId))
      .where(and(eq(settlements.tenantId, tenantId), eq(settlements.id, id)));
    if (!row) return null;
    const lines = await tx.select({ line: settlementLines, auctionNo: auctions.auctionNo, speciesName: fishSpecies.name, unit: auctions.unit, grade: auctions.grade, vesselName: vessels.name, awardSource: auctions.awardSource })
      .from(settlementLines).innerJoin(auctions, eq(auctions.id, settlementLines.auctionId)).innerJoin(intakes, eq(intakes.id, auctions.intakeId)).innerJoin(vessels, eq(vessels.id, intakes.vesselId)).leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(eq(settlementLines.settlementId, id)).orderBy(asc(auctions.auctionNo));
    return { ...row, lines };
  });
}

/** 회차 정산 확정 → 회계 어댑터 → confirmed, 물품 settled, 정산서 발급 알림 */
export async function confirmRoundSettlements(ctx: TenantContext, roundId: string) {
  const tenant = ctx.tenant;
  const adapter = getAccountingAdapter(tenant.accountingAdapter);
  const pending = await listSettlements(tenant.id, { roundId, status: ["pending"] });
  if (pending.length === 0) throw stateError("확정할 정산이 없습니다. 먼저 정산을 생성하세요");
  const stillOpen = await withTenant(tenant.id, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.roundId, roundId), inArray(auctions.status, ["open", "closing", "closed_digital", "field_open", "rebid", "disputed", "announced"]))));
  if (stillOpen[0].n > 0) throw stateError("개찰이 끝나지 않은 물품이 있어 정산을 확정할 수 없습니다");

  let ok = 0, fail = 0;
  for (const p of pending) {
    const detail = await getSettlement(tenant.id, p.s.id);
    const r = await adapter.push(tenant.id, {
      tenantCode: tenant.code, settlementNo: p.s.settlementNo, partyType: p.s.partyType, partyName: p.partyName,
      grossAmount: p.s.grossAmount, feeAmount: p.s.feeAmount, vatAmount: p.s.vatAmount, netAmount: p.s.netAmount,
      lines: (detail?.lines ?? []).map((l) => ({ auctionNo: l.auctionNo ?? "", quantity: l.line.quantity, unitPrice: l.line.unitPrice, grossAmount: l.line.grossAmount })),
    });
    if (!r.ok) { fail++; continue; }
    await withTenant(tenant.id, async (tx) => {
      await tx.update(settlements).set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: ctx.session.userId, erpRef: r.ref ?? null }).where(eq(settlements.id, p.s.id));
      await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "settlement.confirm", targetType: "settlement", targetId: p.s.id, before: { status: "pending" }, after: { status: "confirmed", erpRef: r.ref } }, tx);
    });
    await notify({ tenantId: tenant.id, userIds: [p.s.partyUserId], type: "settlement_issued", title: `정산서 발급 · ${p.s.settlementNo}`, body: `${p.roundLabel} · ${p.s.partyType === "shipper" ? "지급액" : "청구액"} ${won(p.s.netAmount)}`, link: `/t/${tenant.code}/${p.s.partyType}/settlement`, channels: ["email"] });
    ok++;
  }
  if (fail === 0) {
    await withTenant(tenant.id, (tx) => tx.update(auctions).set({ status: "settled" }).where(and(eq(auctions.roundId, roundId), eq(auctions.status, "awarded"))));
  } else {
    const ops = [ctx.session.userId];
    await notify({ tenantId: tenant.id, userIds: ops, type: "system", title: "정산 회계 연동 실패", body: `${fail}건 전송 실패 — 재시도하세요`, link: `/t/${tenant.code}/operator/settlement?round=${roundId}`, channels: ["email"] });
  }
  return { ok, fail };
}

export async function markPaid(ctx: TenantContext, settlementId: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [s] = await tx.select().from(settlements).where(and(eq(settlements.tenantId, ctx.tenant.id), eq(settlements.id, settlementId)));
    if (!s) throw notFound();
    if (s.status !== "confirmed") throw stateError("확정된 정산만 지급 처리할 수 있습니다");
    await tx.update(settlements).set({ status: "paid", paidAt: new Date() }).where(eq(settlements.id, s.id));
    await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "settlement.paid", targetType: "settlement", targetId: s.id }, tx);
  });
}

/** 회차 정산 KPI */
export async function roundSettlementSummary(tenant: Tenant, roundId: string) {
  const rows = await listSettlements(tenant.id, { roundId });
  const shippers = rows.filter((r) => r.s.partyType === "shipper");
  const brokers = rows.filter((r) => r.s.partyType === "broker");
  return {
    gross: shippers.reduce((s, r) => s + r.s.grossAmount, 0),
    marketFee: shippers.reduce((s, r) => s + r.s.feeAmount, 0),
    brokerFee: brokers.reduce((s, r) => s + r.s.feeAmount, 0),
    shipperPayable: shippers.reduce((s, r) => s + r.s.netAmount, 0),
    shippers, brokers,
    allConfirmed: rows.length > 0 && rows.every((r) => r.s.status !== "pending"),
  };
}
