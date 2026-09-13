import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withTenant } from "@/db/context";
import { rounds, intakes, auctions, vessels, fishSpecies, memberships, roundSubscriptions, type Tenant, type Round, type BidUnit } from "@/db/schema";
import { ensureTodayRounds, getRound, listRounds } from "./round";
import { audit } from "./audit";
import { toKg } from "@/domain/settlement/calc";
import { forbidden, notFound } from "@/lib/errors";
import { localDateStr } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/context";

/**
 * 노조 서비스 — 읽기 전용, 가격·입찰·중매인·정산·선주 개인정보를 절대 반환하지 않는다.
 * (auctions 에서 선택하는 컬럼: species/weight/unit/quantity/status 만)
 */

export interface SpeciesSummary { code: string; name: string; lots: number; weightKg: number; unit: BidUnit; quantity: number; estKg: number }
export interface RoundCounts { intakes: number; vessels: number; lots: number; weightKg: number; species: SpeciesSummary[] }

const shiftDate = (dateStr: string, days: number) => localDateStr(new Date(new Date(`${dateStr}T12:00:00+09:00`).getTime() + days * 86_400_000));

/** 회차별 입고·선박·어종 요약 (가격 정보 없음) */
async function roundCounts(tenant: Tenant, roundIds: string[]): Promise<Map<string, RoundCounts>> {
  const map = new Map<string, RoundCounts>();
  for (const id of roundIds) map.set(id, { intakes: 0, vessels: 0, lots: 0, weightKg: 0, species: [] });
  if (roundIds.length === 0) return map;
  const rows = await withTenant(tenant.id, (tx) => tx.select({
    roundId: auctions.roundId, speciesCode: auctions.speciesCode, speciesName: fishSpecies.name, unit: auctions.unit,
    lots: sql<number>`count(*)::int`, weightKg: sql<number>`coalesce(sum(${auctions.weightKg}),0)::float`, quantity: sql<number>`coalesce(sum(${auctions.quantity}),0)::float`,
  }).from(auctions).innerJoin(intakes, eq(intakes.id, auctions.intakeId)).leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
    .where(and(eq(auctions.tenantId, tenant.id), inArray(auctions.roundId, roundIds), sql`${auctions.status} <> 'withdrawn'`, sql`${intakes.status} <> 'deleted'`))
    .groupBy(auctions.roundId, auctions.speciesCode, fishSpecies.name, auctions.unit));
  // 회차 단위 distinct 카운트는 별도 집계
  const heads = await withTenant(tenant.id, (tx) => tx.select({
    roundId: auctions.roundId, intakeCount: sql<number>`count(distinct ${auctions.intakeId})::int`, vesselCount: sql<number>`count(distinct ${intakes.vesselId})::int`,
  }).from(auctions).innerJoin(intakes, eq(intakes.id, auctions.intakeId))
    .where(and(eq(auctions.tenantId, tenant.id), inArray(auctions.roundId, roundIds), sql`${auctions.status} <> 'withdrawn'`, sql`${intakes.status} <> 'deleted'`)).groupBy(auctions.roundId));
  for (const h of heads) { const c = map.get(h.roundId ?? ""); if (c) { c.intakes = h.intakeCount; c.vessels = h.vesselCount; } }
  for (const r of rows) {
    const c = map.get(r.roundId ?? "");
    if (!c) continue;
    c.lots += r.lots; c.weightKg += r.weightKg;
    c.species.push({ code: r.speciesCode, name: r.speciesName ?? r.speciesCode, lots: r.lots, weightKg: r.weightKg, unit: r.unit, quantity: r.quantity, estKg: toKg(r.quantity, r.unit, r.speciesCode, tenant.boxWeightTable, r.weightKg) });
  }
  for (const c of map.values()) c.species.sort((a, b) => b.weightKg - a.weightKg);
  return map;
}

export type UnionRoundCard = Round & { counts: RoundCounts; subscribed: boolean };

/** 오늘(+내일 예정) 회차 개요 */
export async function todayOverview(tenant: Tenant, userId: string) {
  const today = localDateStr();
  const tomorrow = shiftDate(today, 1);
  const [todayRounds, tomorrowRounds] = await Promise.all([ensureTodayRounds(tenant, today), listRounds(tenant.id, { from: tomorrow, to: tomorrow })]);
  const all = [...todayRounds, ...tomorrowRounds];
  const [counts, subs] = await Promise.all([roundCounts(tenant, all.map((r) => r.id)), mySubscriptions(tenant.id, userId)]);
  const deco = (r: Round): UnionRoundCard => ({ ...r, counts: counts.get(r.id)!, subscribed: subs.has(r.id) });
  return { today, todayRounds: todayRounds.map(deco), tomorrowRounds: tomorrowRounds.sort((a, b) => a.seq - b.seq).map(deco) };
}

/** 주간 일정 — startDate 부터 7일 */
export async function weekSchedule(tenant: Tenant, startDate: string) {
  const today = localDateStr();
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(startDate, i));
  // 오늘 이후 날짜의 회차는 Tenant.schedule 기준으로 미리 생성 (노조 운반 계획용)
  for (const d of days) if (d >= today && d <= shiftDate(today, 7)) await ensureTodayRounds(tenant, d);
  const rs = await listRounds(tenant.id, { from: days[0], to: days[6], limit: 200 });
  const counts = await roundCounts(tenant, rs.map((r) => r.id));
  const byDate = new Map<string, (Round & { counts: RoundCounts })[]>();
  for (const d of days) byDate.set(d, []);
  for (const r of rs) byDate.get(r.date)?.push({ ...r, counts: counts.get(r.id)! });
  for (const list of byDate.values()) list.sort((a, b) => a.seq - b.seq);
  return { days: days.map((d) => ({ date: d, rounds: byDate.get(d) ?? [], isToday: d === today })), today, prevStart: shiftDate(startDate, -7), nextStart: shiftDate(startDate, 7) };
}

/** 회차 상세 — 선박 도착 순서 + 어종별 표 (가격·선주·중매인 없음) */
export async function roundDetail(tenant: Tenant, roundId: string, userId: string) {
  const round = await getRound(tenant.id, roundId);
  if (!round) throw notFound("회차를 찾을 수 없습니다");
  const [vesselRows, counts, subs] = await Promise.all([
    withTenant(tenant.id, (tx) => tx.select({
      intakeId: intakes.id, vesselName: vessels.name, arrivedAt: intakes.arrivedAt, intakeStatus: intakes.status,
      lots: sql<number>`count(${auctions.id})::int`, weightKg: sql<number>`coalesce(sum(${auctions.weightKg}),0)::float`,
      species: sql<string | null>`string_agg(distinct coalesce(${fishSpecies.name}, ${auctions.speciesCode}), ', ')`,
    }).from(intakes).innerJoin(vessels, eq(vessels.id, intakes.vesselId))
      .leftJoin(auctions, and(eq(auctions.intakeId, intakes.id), sql`${auctions.status} <> 'withdrawn'`))
      .leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(and(eq(intakes.tenantId, tenant.id), eq(intakes.roundId, roundId), sql`${intakes.status} <> 'deleted'`))
      .groupBy(intakes.id, vessels.name, intakes.arrivedAt, intakes.status).orderBy(asc(intakes.arrivedAt))),
    roundCounts(tenant, [roundId]),
    mySubscriptions(tenant.id, userId),
  ]);
  const c = counts.get(roundId)!;
  return { round, vessels: vesselRows, counts: c, totalEstKg: c.species.reduce((s, x) => s + x.estKg, 0), subscribed: subs.has(roundId) };
}
export type UnionRoundDetail = Awaited<ReturnType<typeof roundDetail>>;

// ───────── 회차 알림 구독 (self data) ─────────
export async function mySubscriptions(tenantId: string, userId: string) {
  const rows = await withTenant(tenantId, (tx) => tx.select({ roundId: roundSubscriptions.roundId }).from(roundSubscriptions).where(and(eq(roundSubscriptions.tenantId, tenantId), eq(roundSubscriptions.userId, userId))));
  return new Set(rows.map((r) => r.roundId));
}

/** 구독 토글. 노조 역할 본인 데이터 — Tenant 상태와 무관하게 허용, Platform Admin 읽기 모드는 불가 */
export async function toggleRoundSubscription(ctx: TenantContext, roundId: string) {
  if (!ctx.roles.includes("union") || (ctx.isPlatformAdmin && !ctx.role)) throw forbidden("노조 담당자만 회차 알림을 구독할 수 있습니다");
  const userId = ctx.session.userId;
  return withTenant(ctx.tenant.id, async (tx) => {
    const [r] = await tx.select({ id: rounds.id, label: rounds.label }).from(rounds).where(and(eq(rounds.tenantId, ctx.tenant.id), eq(rounds.id, roundId))).limit(1);
    if (!r) throw notFound("회차를 찾을 수 없습니다");
    const [existing] = await tx.select({ id: roundSubscriptions.id }).from(roundSubscriptions).where(and(eq(roundSubscriptions.roundId, roundId), eq(roundSubscriptions.userId, userId))).limit(1);
    if (existing) {
      await tx.delete(roundSubscriptions).where(eq(roundSubscriptions.id, existing.id));
      await audit({ tenantId: ctx.tenant.id, actorUserId: userId, actorRole: "union", action: "union.round_unsubscribe", targetType: "round", targetId: roundId }, tx);
      return { subscribed: false, label: r.label };
    }
    await tx.insert(roundSubscriptions).values({ tenantId: ctx.tenant.id, roundId, userId });
    await audit({ tenantId: ctx.tenant.id, actorUserId: userId, actorRole: "union", action: "union.round_subscribe", targetType: "round", targetId: roundId }, tx);
    return { subscribed: true, label: r.label };
  });
}

// ───────── 작업량 통계 ─────────
export interface WorkVolumeDay { date: string; rounds: number; intakes: number; lots: number; weightKg: number }
export async function workVolume(ctx: TenantContext, from: string, to: string) {
  const tenantId = ctx.tenant.id;
  const [days, species, hours, [m]] = await Promise.all([
    withTenant(tenantId, (tx) => tx.select({
      date: rounds.date,
      rounds: sql<number>`count(distinct ${rounds.id})::int`,
      intakes: sql<number>`count(distinct ${auctions.intakeId})::int`,
      lots: sql<number>`count(${auctions.id})::int`,
      weightKg: sql<number>`coalesce(sum(${auctions.weightKg}),0)::float`,
    }).from(rounds).leftJoin(auctions, and(eq(auctions.roundId, rounds.id), sql`${auctions.status} <> 'withdrawn'`))
      .where(and(eq(rounds.tenantId, tenantId), gte(rounds.date, from), lte(rounds.date, to), sql`${rounds.status} <> 'cancelled'`)).groupBy(rounds.date).orderBy(asc(rounds.date))),
    withTenant(tenantId, (tx) => tx.select({
      code: auctions.speciesCode, name: fishSpecies.name, lots: sql<number>`count(*)::int`, weightKg: sql<number>`coalesce(sum(${auctions.weightKg}),0)::float`,
    }).from(auctions).innerJoin(rounds, eq(rounds.id, auctions.roundId)).leftJoin(fishSpecies, eq(fishSpecies.code, auctions.speciesCode))
      .where(and(eq(auctions.tenantId, tenantId), gte(rounds.date, from), lte(rounds.date, to), sql`${auctions.status} <> 'withdrawn'`)).groupBy(auctions.speciesCode, fishSpecies.name)),
    withTenant(tenantId, (tx) => tx.select({
      hour: sql<number>`extract(hour from ${intakes.arrivedAt} at time zone 'Asia/Seoul')::int`, intakes: sql<number>`count(*)::int`,
    }).from(intakes).innerJoin(rounds, eq(rounds.id, intakes.roundId))
      .where(and(eq(intakes.tenantId, tenantId), gte(rounds.date, from), lte(rounds.date, to), sql`${intakes.status} <> 'deleted'`)).groupBy(sql`1`).orderBy(sql`1`)),
    ctx.membershipId
      ? db.select({ squadCode: memberships.squadCode, title: memberships.title }).from(memberships).where(eq(memberships.id, ctx.membershipId)).limit(1)
      : Promise.resolve([{ squadCode: null as string | null, title: null as string | null }]),
  ]);
  const totals = days.reduce((s, d) => ({ rounds: s.rounds + d.rounds, intakes: s.intakes + d.intakes, lots: s.lots + d.lots, weightKg: s.weightKg + d.weightKg }), { rounds: 0, intakes: 0, lots: 0, weightKg: 0 });
  return {
    days: days as WorkVolumeDay[], totals,
    species: species.map((s) => ({ ...s, name: s.name ?? s.code, share: totals.weightKg ? s.weightKg / totals.weightKg : 0 })).sort((a, b) => b.weightKg - a.weightKg),
    hours, squadCode: m?.squadCode ?? null, squadTitle: m?.title ?? null,
  };
}
