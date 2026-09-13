import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { rounds, auctions, type Round, type Tenant } from "@/db/schema";
import { kstDateTime, localDateStr, fmtShortDate } from "@/lib/format";
import { withTenant } from "@/db/context";
import { audit } from "./audit";
import { validation } from "@/lib/errors";

export async function listRounds(tenantId: string, opts: { from?: string; to?: string; limit?: number } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(rounds.tenantId, tenantId)];
    if (opts.from) conds.push(gte(rounds.date, opts.from));
    if (opts.to) conds.push(lte(rounds.date, opts.to));
    return tx.select().from(rounds).where(and(...conds)).orderBy(desc(rounds.date), asc(rounds.seq)).limit(opts.limit ?? 50);
  });
}

export async function getRound(tenantId: string, roundId: string) {
  return withTenant(tenantId, async (tx) => (await tx.select().from(rounds).where(and(eq(rounds.tenantId, tenantId), eq(rounds.id, roundId))).limit(1))[0] ?? null);
}

/** 오늘(KST) 회차 — Tenant.schedule 기준으로 없으면 자동 생성 */
export async function ensureTodayRounds(tenant: Tenant, dateStr = localDateStr()): Promise<Round[]> {
  return withTenant(tenant.id, async (tx) => {
    const existing = await tx.select().from(rounds).where(and(eq(rounds.tenantId, tenant.id), eq(rounds.date, dateStr))).orderBy(asc(rounds.seq));
    const have = new Set(existing.map((r) => r.seq));
    const dow = new Date(`${dateStr}T00:00:00+09:00`).getDay();
    const created: Round[] = [];
    for (const slot of tenant.schedule) {
      if (have.has(slot.seq)) continue;
      if (slot.days && !slot.days.includes(dow)) continue;
      const close = kstDateTime(dateStr, slot.bidClose);
      const [r] = await tx.insert(rounds).values({
        tenantId: tenant.id, date: dateStr, seq: slot.seq, label: `${fmtShortDate(close)} ${slot.label}`,
        bidStartAt: kstDateTime(dateStr, slot.bidStart), bidCloseAt: close,
        fieldStartAt: tenant.fieldAuctionEnabled ? new Date(close.getTime() + tenant.digitalCloseBufferMin * 60_000) : null,
        status: "scheduled",
      }).returning();
      created.push(r);
    }
    return [...existing, ...created].sort((a, b) => a.seq - b.seq);
  });
}

/** 현재 입고 대상 회차 — 아직 마감되지 않은 가장 빠른 회차 (오늘 우선, 없으면 내일) */
export async function currentIntakeRound(tenant: Tenant): Promise<Round | null> {
  const today = localDateStr();
  const list = await ensureTodayRounds(tenant, today);
  const now = Date.now();
  const open = list.find((r) => r.bidCloseAt.getTime() > now && r.status !== "cancelled");
  if (open) return open;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const t = await ensureTodayRounds(tenant, localDateStr(tomorrow));
  return t.find((r) => r.status !== "cancelled") ?? null;
}

export interface RoundInput { date: string; seq: number; label: string; bidStartAt: Date; bidCloseAt: Date; fieldStartAt?: Date | null }

export async function upsertRound(tenant: Tenant, actorUserId: string, input: RoundInput, roundId?: string) {
  if (input.bidCloseAt <= input.bidStartAt) throw validation("입찰 마감은 시작 이후여야 합니다");
  if (input.fieldStartAt && input.fieldStartAt.getTime() < input.bidCloseAt.getTime() + tenant.digitalCloseBufferMin * 60_000)
    throw validation(`현장 경매 시작은 디지털 마감 + ${tenant.digitalCloseBufferMin}분 이후여야 합니다`);
  return withTenant(tenant.id, async (tx) => {
    if (roundId) {
      const [before] = await tx.select().from(rounds).where(and(eq(rounds.tenantId, tenant.id), eq(rounds.id, roundId)));
      const [r] = await tx.update(rounds).set({ ...input, fieldStartAt: input.fieldStartAt ?? null }).where(eq(rounds.id, roundId)).returning();
      // 회차 시각 변경 → 소속 경매의 상태 재평가는 스케줄러가 처리
      await audit({ tenantId: tenant.id, actorUserId, action: "round.update", targetType: "round", targetId: roundId, before, after: r }, tx);
      return r;
    }
    const [r] = await tx.insert(rounds).values({ tenantId: tenant.id, ...input, fieldStartAt: input.fieldStartAt ?? null }).returning();
    await audit({ tenantId: tenant.id, actorUserId, action: "round.create", targetType: "round", targetId: r.id, after: r }, tx);
    return r;
  });
}

export async function roundLotCount(tenantId: string, roundId: string, tx?: DbOrTx) {
  const run = async (t: DbOrTx) => (await t.select({ n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.tenantId, tenantId), eq(auctions.roundId, roundId))))[0].n;
  return tx ? run(tx) : withTenant(tenantId, run);
}
