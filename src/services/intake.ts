import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { auctions, intakes, vessels, users, rounds, type BidUnit, type Grade, type Tenant, type IntakeStatus } from "@/db/schema";
import { withTenant } from "@/db/context";
import { audit } from "./audit";
import { notify, usersByRoles } from "./notification";
import { makeAuctionNo } from "@/domain/auction/award";
import { quantityFromWeight } from "@/domain/settlement/calc";
import { stateError, validation, notFound } from "@/lib/errors";
import { localStorageAdapter } from "@/adapters/storage";
import type { TenantContext } from "@/lib/auth/context";

export interface LotInput {
  tankNo?: string | null; speciesCode: string; weightKg: number; unit: BidUnit; quantity?: number | null; grade: Grade; note?: string | null; photos?: string[];
}
export interface IntakeInput {
  vesselId: string; arrivedAt: Date; roundId?: string | null; note?: string | null; clientRef?: string | null; items: LotInput[];
}

function validateLot(l: LotInput) {
  if (!l.speciesCode) throw validation("어종을 선택하세요");
  if (!(l.weightKg > 0)) throw validation("중량은 0보다 커야 합니다");
  if (!["kg", "box", "ea"].includes(l.unit)) throw validation("입찰 단위가 올바르지 않습니다");
  if (!["A", "B", "C"].includes(l.grade)) throw validation("등급이 올바르지 않습니다");
  if (l.note && l.note.length > 100) throw validation("참고사항은 100자 이내");
}

const lotValues = (tenant: Tenant, intakeId: string, roundId: string | null, l: LotInput) => ({
  tenantId: tenant.id, intakeId, roundId, tankNo: l.tankNo || null, speciesCode: l.speciesCode, weightKg: l.weightKg, unit: l.unit,
  quantity: quantityFromWeight(l.weightKg, l.unit, l.speciesCode, tenant.boxWeightTable, l.quantity), grade: l.grade, note: l.note || null,
  photos: l.photos ?? [], status: "registered" as const, reservePrice: tenant.reservePrices[l.speciesCode] ?? null,
});

export async function listIntakes(tenantId: string, opts: { date?: string; roundId?: string; vesselId?: string; shipperUserId?: string; status?: IntakeStatus[]; limit?: number; from?: Date; to?: Date } = {}) {
  return withTenant(tenantId, async (tx) => {
    const conds = [eq(intakes.tenantId, tenantId), sql`${intakes.status} <> 'deleted'`];
    if (opts.roundId) conds.push(eq(intakes.roundId, opts.roundId));
    if (opts.vesselId) conds.push(eq(intakes.vesselId, opts.vesselId));
    if (opts.shipperUserId) conds.push(eq(vessels.shipperUserId, opts.shipperUserId));
    if (opts.status) conds.push(inArray(intakes.status, opts.status));
    if (opts.date) {
      const start = new Date(`${opts.date}T00:00:00+09:00`); const end = new Date(start.getTime() + 86_400_000);
      conds.push(gte(intakes.arrivedAt, start), lt(intakes.arrivedAt, end));
    }
    if (opts.from) conds.push(gte(intakes.arrivedAt, opts.from));
    if (opts.to) conds.push(lt(intakes.arrivedAt, opts.to));
    return tx.select({
      id: intakes.id, arrivedAt: intakes.arrivedAt, status: intakes.status, roundId: intakes.roundId, note: intakes.note, createdBy: intakes.createdBy, confirmedAt: intakes.confirmedAt,
      vesselId: vessels.id, vesselName: vessels.name, shipperUserId: vessels.shipperUserId, shipperName: users.name, roundLabel: rounds.label,
      lotCount: sql<number>`(select count(*)::int from ${auctions} a where a.intake_id = ${intakes.id} and a.status <> 'withdrawn')`,
      totalWeight: sql<number>`(select coalesce(sum(a.weight_kg),0)::float from ${auctions} a where a.intake_id = ${intakes.id} and a.status <> 'withdrawn')`,
    }).from(intakes)
      .innerJoin(vessels, eq(vessels.id, intakes.vesselId))
      .leftJoin(users, eq(users.id, vessels.shipperUserId))
      .leftJoin(rounds, eq(rounds.id, intakes.roundId))
      .where(and(...conds)).orderBy(desc(intakes.arrivedAt)).limit(opts.limit ?? 100);
  });
}

export async function getIntake(tenantId: string, intakeId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({
      intake: intakes, vesselName: vessels.name, shipperUserId: vessels.shipperUserId, shipperName: users.name, roundLabel: rounds.label, round: rounds,
    }).from(intakes).innerJoin(vessels, eq(vessels.id, intakes.vesselId)).leftJoin(users, eq(users.id, vessels.shipperUserId)).leftJoin(rounds, eq(rounds.id, intakes.roundId))
      .where(and(eq(intakes.tenantId, tenantId), eq(intakes.id, intakeId))).limit(1);
    if (!row) return null;
    const items = await tx.select().from(auctions).where(and(eq(auctions.intakeId, intakeId), sql`${auctions.status} <> 'withdrawn'`)).orderBy(asc(auctions.createdAt));
    return { ...row, items };
  });
}

export async function createIntake(ctx: TenantContext, input: IntakeInput) {
  const tenant = ctx.tenant; const actor = ctx.session.userId;
  if (!input.vesselId) throw validation("선박을 선택하세요");
  input.items.forEach(validateLot);
  return withTenant(tenant.id, async (tx) => {
    if (input.clientRef) {
      const dup = await tx.select({ id: intakes.id }).from(intakes).where(and(eq(intakes.tenantId, tenant.id), eq(intakes.clientRef, input.clientRef))).limit(1);
      if (dup.length) return { id: dup[0].id, duplicate: true };
    }
    const [it] = await tx.insert(intakes).values({
      tenantId: tenant.id, vesselId: input.vesselId, roundId: input.roundId ?? null, arrivedAt: input.arrivedAt, note: input.note ?? null,
      createdBy: actor, clientRef: input.clientRef ?? null, status: "draft",
    }).returning();
    if (input.items.length) await tx.insert(auctions).values(input.items.map((l) => lotValues(tenant, it.id, input.roundId ?? null, l)));
    await audit({ tenantId: tenant.id, actorUserId: actor, actorRole: ctx.role, action: "intake.create", targetType: "intake", targetId: it.id, after: { ...it, items: input.items.length } }, tx);
    return { id: it.id, duplicate: false };
  });
}

async function loadEditable(tx: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string, intakeId: string, ctx: TenantContext) {
  const [it] = await tx.select().from(intakes).where(and(eq(intakes.tenantId, tenantId), eq(intakes.id, intakeId))).limit(1);
  if (!it) throw notFound("입고를 찾을 수 없습니다");
  if (it.status === "deleted") throw stateError("삭제된 입고입니다");
  const isDraft = it.status === "draft";
  if (!isDraft) {
    // 확정 후 수정 = 정정 (operator/admin 만, 감사 로그)
    if (!ctx.roles.some((r) => r === "admin" || r === "operator")) throw stateError("확정된 입고는 운영자만 정정할 수 있습니다");
    if (["announced"].includes(it.status)) {
      const open = await tx.select({ id: auctions.id }).from(auctions).where(and(eq(auctions.intakeId, intakeId), inArray(auctions.status, ["awarded", "passed", "settled", "closed_digital", "field_open"]))).limit(1);
      if (open.length) throw stateError("개찰이 진행된 물품이 있어 정정할 수 없습니다");
    }
  }
  return { it, isDraft };
}

export async function addLot(ctx: TenantContext, intakeId: string, lot: LotInput) {
  validateLot(lot);
  return withTenant(ctx.tenant.id, async (tx) => {
    const { it, isDraft } = await loadEditable(tx, ctx.tenant.id, intakeId, ctx);
    const values = lotValues(ctx.tenant, it.id, it.roundId, lot);
    if (!isDraft) {
      // 확정 후 추가 → 즉시 번호 부여
      const no = await nextAuctionNo(tx, ctx.tenant, it.roundId!);
      Object.assign(values, { auctionNo: no.no, status: it.status === "announced" ? "announced" : "registered" });
    }
    const [a] = await tx.insert(auctions).values(values).returning();
    if (!isDraft) await tx.update(intakes).set({ status: "corrected" }).where(eq(intakes.id, it.id));
    await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: isDraft ? "intake.add_lot" : "intake.correct_add", targetType: "auction", targetId: a.id, after: a }, tx);
    return a;
  });
}

export async function updateLot(ctx: TenantContext, auctionId: string, lot: Partial<LotInput>, reason?: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [a] = await tx.select().from(auctions).where(and(eq(auctions.tenantId, ctx.tenant.id), eq(auctions.id, auctionId))).limit(1);
    if (!a) throw notFound("물품을 찾을 수 없습니다");
    const { it, isDraft } = await loadEditable(tx, ctx.tenant.id, a.intakeId, ctx);
    if (!isDraft && !reason) throw validation("정정 사유를 입력하세요");
    if (a.bidCount > 0 && (lot.speciesCode || lot.unit || lot.weightKg)) throw stateError("입찰이 있는 물품은 어종·단위·중량을 변경할 수 없습니다");
    const merged: LotInput = { tankNo: lot.tankNo ?? a.tankNo, speciesCode: lot.speciesCode ?? a.speciesCode, weightKg: lot.weightKg ?? a.weightKg, unit: lot.unit ?? a.unit, quantity: lot.quantity ?? (lot.weightKg || lot.unit ? null : a.quantity), grade: lot.grade ?? a.grade, note: lot.note ?? a.note, photos: lot.photos ?? a.photos };
    validateLot(merged);
    const v = lotValues(ctx.tenant, a.intakeId, a.roundId, merged);
    const [after] = await tx.update(auctions).set({ tankNo: v.tankNo, speciesCode: v.speciesCode, weightKg: v.weightKg, unit: v.unit, quantity: v.quantity, grade: v.grade, note: v.note, photos: v.photos, reservePrice: v.reservePrice }).where(eq(auctions.id, auctionId)).returning();
    if (!isDraft) await tx.update(intakes).set({ status: "corrected" }).where(eq(intakes.id, it.id));
    await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: isDraft ? "intake.update_lot" : "intake.correct_lot", targetType: "auction", targetId: auctionId, before: a, after, reason }, tx);
    return after;
  });
}

export async function removeLot(ctx: TenantContext, auctionId: string, reason?: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [a] = await tx.select().from(auctions).where(and(eq(auctions.tenantId, ctx.tenant.id), eq(auctions.id, auctionId))).limit(1);
    if (!a) throw notFound("물품을 찾을 수 없습니다");
    const { isDraft } = await loadEditable(tx, ctx.tenant.id, a.intakeId, ctx);
    if (a.bidCount > 0) throw stateError("입찰이 있는 물품은 삭제할 수 없습니다");
    if (isDraft) await tx.delete(auctions).where(eq(auctions.id, auctionId));
    else {
      if (!reason) throw validation("취소 사유를 입력하세요");
      await tx.update(auctions).set({ status: "withdrawn" }).where(eq(auctions.id, auctionId));
      await tx.update(intakes).set({ status: "corrected" }).where(eq(intakes.id, a.intakeId));
    }
    await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: isDraft ? "intake.remove_lot" : "intake.withdraw_lot", targetType: "auction", targetId: auctionId, before: a, reason }, tx);
  });
}

export async function updateIntakeHeader(ctx: TenantContext, intakeId: string, patch: { vesselId?: string; arrivedAt?: Date; roundId?: string | null; note?: string | null }) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const { it, isDraft } = await loadEditable(tx, ctx.tenant.id, intakeId, ctx);
    if (!isDraft && patch.roundId !== undefined && patch.roundId !== it.roundId) throw stateError("확정된 입고의 회차는 변경할 수 없습니다");
    const [after] = await tx.update(intakes).set(patch).where(eq(intakes.id, intakeId)).returning();
    if (patch.roundId !== undefined) await tx.update(auctions).set({ roundId: patch.roundId }).where(eq(auctions.intakeId, intakeId));
    await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "intake.update", targetType: "intake", targetId: intakeId, before: it, after }, tx);
    return after;
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
/** 회차 내 다음 경매번호 (회차 행 잠금으로 직렬화) */
async function nextAuctionNo(tx: Tx, tenant: Tenant, roundId: string) {
  const [r] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).for("update");
  if (!r) throw stateError("회차가 지정되지 않았습니다");
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.roundId, roundId), sql`${auctions.auctionNo} is not null`));
  return { no: makeAuctionNo(tenant.code, r.date, r.seq, n + 1), round: r };
}

/** 전체 입고 확정 → 경매번호 부여, 회차에 묶임 */
export async function confirmIntake(ctx: TenantContext, intakeId: string, roundId?: string | null) {
  const tenant = ctx.tenant;
  const result = await withTenant(tenant.id, async (tx) => {
    const [it] = await tx.select().from(intakes).where(and(eq(intakes.tenantId, tenant.id), eq(intakes.id, intakeId))).limit(1);
    if (!it) throw notFound("입고를 찾을 수 없습니다");
    if (it.status !== "draft") throw stateError("이미 확정된 입고입니다");
    const rid = roundId ?? it.roundId;
    if (!rid) throw validation("경매 회차를 선택하세요");
    const items = await tx.select().from(auctions).where(eq(auctions.intakeId, intakeId)).orderBy(asc(auctions.createdAt));
    if (items.length === 0) throw validation("품목이 1개 이상 필요합니다");
    let round;
    for (const a of items) {
      const next = await nextAuctionNo(tx, tenant, rid);
      round = next.round;
      if (round.status === "done" || round.status === "cancelled" || round.status === "auctioning" || round.bidCloseAt.getTime() <= Date.now()) throw stateError("입찰이 마감된 회차에는 입고할 수 없습니다. 다음 회차를 선택하세요");
      const status = round.status === "scheduled" ? "registered" : round.status === "announced" ? "announced" : "open";
      await tx.update(auctions).set({ auctionNo: next.no, roundId: rid, status }).where(eq(auctions.id, a.id));
    }
    const newStatus = round!.status === "scheduled" ? "confirmed" : "announced";
    const [after] = await tx.update(intakes).set({ status: newStatus, roundId: rid, confirmedAt: new Date(), confirmedBy: ctx.session.userId }).where(eq(intakes.id, intakeId)).returning();
    await audit({ tenantId: tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "intake.confirm", targetType: "intake", targetId: intakeId, before: it, after: { ...after, lots: items.length } }, tx);
    const [v] = await tx.select({ name: vessels.name, shipperUserId: vessels.shipperUserId }).from(vessels).where(eq(vessels.id, it.vesselId));
    return { intake: after, lots: items.length, weight: items.reduce((s, a) => s + a.weightKg, 0), vesselName: v?.name, shipperUserId: v?.shipperUserId, roundLabel: round!.label };
  });
  // 알림: 운영자 (새 입고) + 선주 (입항 등록)
  const ops = await usersByRoles(tenant.id, ["operator", "admin"]);
  await notify({ tenantId: tenant.id, userIds: ops.filter((u) => u !== ctx.session.userId), type: "intake_new", title: `새 입고: ${result.vesselName}`, body: `${result.lots}개 품목 · ${Math.round(result.weight)}kg · ${result.roundLabel}`, link: `/t/${tenant.code}/operator/intake?intake=${intakeId}` });
  if (result.shipperUserId) await notify({ tenantId: tenant.id, userIds: [result.shipperUserId], type: "intake_new", title: `${result.vesselName} 입고 확정`, body: `${result.lots}개 품목이 ${result.roundLabel} 경매에 등록되었습니다`, link: `/t/${tenant.code}/shipper/intake/${intakeId}` });
  return result;
}

export async function deleteDraftIntake(ctx: TenantContext, intakeId: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [it] = await tx.select().from(intakes).where(and(eq(intakes.tenantId, ctx.tenant.id), eq(intakes.id, intakeId))).limit(1);
    if (!it) throw notFound();
    if (it.status !== "draft") throw stateError("확정된 입고는 삭제할 수 없습니다");
    if (it.createdBy !== ctx.session.userId && !ctx.roles.some((r) => r === "admin" || r === "operator")) throw stateError("본인이 등록한 입고만 삭제할 수 있습니다");
    await tx.delete(auctions).where(eq(auctions.intakeId, intakeId));
    await tx.update(intakes).set({ status: "deleted" }).where(eq(intakes.id, intakeId));
    await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.session.userId, actorRole: ctx.role, action: "intake.delete", targetType: "intake", targetId: intakeId, before: it }, tx);
  });
}

export async function savePhoto(tenantCode: string, file: File) {
  if (file.size > 5 * 1024 * 1024) throw validation("사진은 5MB 이하");
  const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  return localStorageAdapter.save(tenantCode, file, ext);
}
