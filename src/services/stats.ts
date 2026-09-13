import "server-only";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/context";
import { auctions, intakes, vessels, users, memberships, fishSpecies, rounds } from "@/db/schema";
import { localDateStr } from "@/lib/format";

/** KST 기준 날짜 범위 [from, to] (YYYY-MM-DD) → 타임스탬프 조건 */
function range(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+09:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+09:00`).getTime() + 86_400_000).toISOString();
  return { start, end };
}
/** postgres.js 는 raw sql 파라미터로 Date 를 직렬화하지 못하므로 ISO 문자열 + ::timestamptz 로 전달 */
const awardedCond = (start: string, end: string) =>
  sql`${auctions.status} in ('awarded','settled') and ${auctions.finalPrice} is not null and ${auctions.awardedAt} >= ${start}::timestamptz and ${auctions.awardedAt} < ${end}::timestamptz`;
const kstDay = sql<string>`to_char(${auctions.awardedAt} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;
const kstMonth = sql<string>`to_char(${auctions.awardedAt} at time zone 'Asia/Seoul', 'YYYY-MM')`;
const amountExpr = sql<number>`coalesce(sum(${auctions.finalPrice} * ${auctions.quantity}), 0)::bigint`;
const weightExpr = sql<number>`coalesce(sum(${auctions.weightKg}), 0)::float8`;
const lotsExpr = sql<number>`count(*)::int`;
const qtyExpr = sql<number>`coalesce(sum(${auctions.quantity}), 0)::float8`;

export interface DailyCatch { date: string; lots: number; weightKg: number; amount: number }

/** 일별 어획량/낙찰금액 (amount = 낙찰단가 × 수량) */
export async function dailyCatch(tenantId: string, from: string, to: string): Promise<DailyCatch[]> {
  const { start, end } = range(from, to);
  const rows = await withTenant(tenantId, (tx) => tx.select({ date: kstDay, lots: lotsExpr, weightKg: weightExpr, amount: amountExpr })
    .from(auctions).where(sql`${auctions.tenantId} = ${tenantId} and ${awardedCond(start, end)}`).groupBy(kstDay).orderBy(kstDay));
  return rows.map((r) => ({ date: r.date, lots: r.lots, weightKg: Number(r.weightKg), amount: Number(r.amount) }));
}

export async function monthlyCatch(tenantId: string, from: string, to: string): Promise<DailyCatch[]> {
  const { start, end } = range(from, to);
  const rows = await withTenant(tenantId, (tx) => tx.select({ date: kstMonth, lots: lotsExpr, weightKg: weightExpr, amount: amountExpr })
    .from(auctions).where(sql`${auctions.tenantId} = ${tenantId} and ${awardedCond(start, end)}`).groupBy(kstMonth).orderBy(kstMonth));
  return rows.map((r) => ({ date: r.date, lots: r.lots, weightKg: Number(r.weightKg), amount: Number(r.amount) }));
}

export interface PricePoint { date: string; avgPrice: number; unit: string; lots: number }

/** 어종 단가 추이 — 최근 days 일, 일별 가중평균 단가(금액/수량) */
export async function speciesPriceTrend(tenantId: string, speciesCode: string, days = 30): Promise<PricePoint[]> {
  const endMs = new Date(`${localDateStr()}T00:00:00+09:00`).getTime() + 86_400_000;
  const end = new Date(endMs).toISOString();
  const start = new Date(endMs - days * 86_400_000).toISOString();
  const rows = await withTenant(tenantId, (tx) => tx.select({
    date: kstDay, lots: lotsExpr, unit: sql<string>`min(${auctions.unit})`,
    avgPrice: sql<number>`coalesce(round(sum(${auctions.finalPrice} * ${auctions.quantity}) / nullif(sum(${auctions.quantity}), 0)), 0)::bigint`,
  }).from(auctions).where(sql`${auctions.tenantId} = ${tenantId} and ${auctions.speciesCode} = ${speciesCode} and ${awardedCond(start, end)}`).groupBy(kstDay).orderBy(kstDay));
  return rows.map((r) => ({ date: r.date, avgPrice: Number(r.avgPrice), unit: r.unit, lots: r.lots }));
}

export interface SpeciesSummary { speciesCode: string; name: string; unit: string; lots: number; weightKg: number; quantity: number; amount: number; avgPrice: number }

export async function speciesSummary(tenantId: string, from: string, to: string): Promise<SpeciesSummary[]> {
  const { start, end } = range(from, to);
  const rows = await withTenant(tenantId, (tx) => tx.select({
    speciesCode: auctions.speciesCode, name: sql<string | null>`min(${fishSpecies.name})`, unit: sql<string>`min(${auctions.unit})`,
    lots: lotsExpr, weightKg: weightExpr, quantity: qtyExpr, amount: amountExpr,
    avgPrice: sql<number>`coalesce(round(sum(${auctions.finalPrice} * ${auctions.quantity}) / nullif(sum(${auctions.quantity}), 0)), 0)::bigint`,
  }).from(auctions).leftJoin(fishSpecies, sql`${fishSpecies.code} = ${auctions.speciesCode}`)
    .where(sql`${auctions.tenantId} = ${tenantId} and ${awardedCond(start, end)}`).groupBy(auctions.speciesCode).orderBy(sql`sum(${auctions.finalPrice} * ${auctions.quantity}) desc`));
  return rows.map((r) => ({ speciesCode: r.speciesCode, name: r.name ?? r.speciesCode, unit: r.unit, lots: r.lots, weightKg: Number(r.weightKg), quantity: Number(r.quantity), amount: Number(r.amount), avgPrice: Number(r.avgPrice) }));
}

export interface BrokerShare { membershipId: string; name: string; licenseNo: string | null; lots: number; amount: number; share: number }

export async function brokerShare(tenantId: string, from: string, to: string): Promise<BrokerShare[]> {
  const { start, end } = range(from, to);
  const rows = await withTenant(tenantId, (tx) => tx.select({
    membershipId: auctions.winnerMembershipId, name: sql<string | null>`min(${users.name})`, licenseNo: sql<string | null>`min(${memberships.licenseNo})`,
    lots: lotsExpr, amount: amountExpr,
  }).from(auctions)
    .leftJoin(memberships, sql`${memberships.id} = ${auctions.winnerMembershipId}`)
    .leftJoin(users, sql`${users.id} = ${memberships.userId}`)
    .where(sql`${auctions.tenantId} = ${tenantId} and ${auctions.winnerMembershipId} is not null and ${awardedCond(start, end)}`)
    .groupBy(auctions.winnerMembershipId).orderBy(sql`sum(${auctions.finalPrice} * ${auctions.quantity}) desc`));
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return rows.map((r) => ({ membershipId: r.membershipId ?? "", name: r.name ?? "-", licenseNo: r.licenseNo, lots: r.lots, amount: Number(r.amount), share: total > 0 ? Number(r.amount) / total : 0 }));
}

export interface ShipperPerformance { userId: string; name: string; vessels: number; lots: number; weightKg: number; amount: number }

export async function shipperPerformance(tenantId: string, from: string, to: string): Promise<ShipperPerformance[]> {
  const { start, end } = range(from, to);
  const rows = await withTenant(tenantId, (tx) => tx.select({
    userId: vessels.shipperUserId, name: sql<string | null>`min(${users.name})`,
    vessels: sql<number>`count(distinct ${vessels.id})::int`, lots: lotsExpr, weightKg: weightExpr, amount: amountExpr,
  }).from(auctions)
    .innerJoin(intakes, sql`${intakes.id} = ${auctions.intakeId}`)
    .innerJoin(vessels, sql`${vessels.id} = ${intakes.vesselId}`)
    .leftJoin(users, sql`${users.id} = ${vessels.shipperUserId}`)
    .where(sql`${auctions.tenantId} = ${tenantId} and ${awardedCond(start, end)}`)
    .groupBy(vessels.shipperUserId).orderBy(sql`sum(${auctions.finalPrice} * ${auctions.quantity}) desc`));
  return rows.map((r) => ({ userId: r.userId ?? "", name: r.name ?? "(선주 미지정)", vessels: r.vessels, lots: r.lots, weightKg: Number(r.weightKg), amount: Number(r.amount) }));
}

export interface KpiToday { date: string; lots: number; awarded: number; passed: number; inProgress: number; amount: number; weightKg: number; avgBidCount: number }

/** 오늘(KST) 회차 기준 KPI */
export async function kpiToday(tenantId: string): Promise<KpiToday> {
  const today = localDateStr();
  const [r] = await withTenant(tenantId, (tx) => tx.select({
    lots: sql<number>`count(*) filter (where ${auctions.status} <> 'withdrawn')::int`,
    awarded: sql<number>`count(*) filter (where ${auctions.status} in ('awarded','settled'))::int`,
    passed: sql<number>`count(*) filter (where ${auctions.status} = 'passed')::int`,
    inProgress: sql<number>`count(*) filter (where ${auctions.status} in ('announced','open','closing','closed_digital','field_open','rebid'))::int`,
    amount: sql<number>`coalesce(sum(${auctions.finalPrice} * ${auctions.quantity}) filter (where ${auctions.status} in ('awarded','settled')), 0)::bigint`,
    weightKg: sql<number>`coalesce(sum(${auctions.weightKg}) filter (where ${auctions.status} <> 'withdrawn'), 0)::float8`,
    avgBidCount: sql<number>`coalesce(avg(${auctions.bidCount}) filter (where ${auctions.status} <> 'withdrawn'), 0)::float8`,
  }).from(auctions).innerJoin(rounds, sql`${rounds.id} = ${auctions.roundId}`)
    .where(sql`${auctions.tenantId} = ${tenantId} and ${rounds.date} = ${today}`));
  return { date: today, lots: r?.lots ?? 0, awarded: r?.awarded ?? 0, passed: r?.passed ?? 0, inProgress: r?.inProgress ?? 0, amount: Number(r?.amount ?? 0), weightKg: Number(r?.weightKg ?? 0), avgBidCount: Number(r?.avgBidCount ?? 0) };
}

/** 기간 합계 (KPI 카드용) */
export async function periodTotals(tenantId: string, from: string, to: string) {
  const { start, end } = range(from, to);
  const [r] = await withTenant(tenantId, (tx) => tx.select({
    lots: lotsExpr, weightKg: weightExpr, amount: amountExpr, days: sql<number>`count(distinct ${kstDay})::int`,
    brokers: sql<number>`count(distinct ${auctions.winnerMembershipId})::int`,
  }).from(auctions).where(sql`${auctions.tenantId} = ${tenantId} and ${awardedCond(start, end)}`));
  return { lots: r?.lots ?? 0, weightKg: Number(r?.weightKg ?? 0), amount: Number(r?.amount ?? 0), days: r?.days ?? 0, brokers: r?.brokers ?? 0 };
}
