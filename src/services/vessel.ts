import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { vessels, users, memberships } from "@/db/schema";
import { withTenant } from "@/db/context";
import { db } from "@/db/client";
import { audit } from "./audit";
import { validation } from "@/lib/errors";

export async function listVessels(tenantId: string, opts: { shipperUserId?: string; includeInactive?: boolean } = {}) {
  return withTenant(tenantId, (tx) => {
    const conds = [eq(vessels.tenantId, tenantId)];
    if (opts.shipperUserId) conds.push(eq(vessels.shipperUserId, opts.shipperUserId));
    if (!opts.includeInactive) conds.push(eq(vessels.active, true));
    return tx.select({
      id: vessels.id, name: vessels.name, registrationNo: vessels.registrationNo, shipperUserId: vessels.shipperUserId, active: vessels.active,
      shipperName: users.name, shipperPhone: users.phone,
    }).from(vessels).leftJoin(users, eq(users.id, vessels.shipperUserId)).where(and(...conds)).orderBy(asc(vessels.name));
  });
}

/** Tenant 의 활성 선주 목록 */
export async function listShippers(tenantId: string) {
  return db.select({ userId: users.id, name: users.name, phone: users.phone, email: users.email, membershipId: memberships.id, status: memberships.status, bankAccount: users.bankAccount, joinedAt: memberships.joinedAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "shipper"))).orderBy(asc(users.name));
}

export async function createVessel(tenantId: string, actorUserId: string, input: { name: string; registrationNo?: string | null; shipperUserId: string }) {
  if (input.name.trim().length < 2) throw validation("선박명은 2자 이상");
  const [ok] = await db.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, input.shipperUserId), eq(memberships.role, "shipper"), eq(memberships.status, "active"))).limit(1);
  if (!ok) throw validation("등록된 선주가 아닙니다");
  return withTenant(tenantId, async (tx) => {
    const [v] = await tx.insert(vessels).values({ tenantId, name: input.name.trim(), registrationNo: input.registrationNo || null, shipperUserId: input.shipperUserId }).returning();
    await audit({ tenantId, actorUserId, action: "vessel.create", targetType: "vessel", targetId: v.id, after: v }, tx);
    return v;
  });
}

export async function updateVessel(tenantId: string, actorUserId: string, vesselId: string, patch: { name?: string; registrationNo?: string | null; shipperUserId?: string; active?: boolean }) {
  return withTenant(tenantId, async (tx) => {
    const [before] = await tx.select().from(vessels).where(and(eq(vessels.tenantId, tenantId), eq(vessels.id, vesselId)));
    if (!before) throw validation("선박을 찾을 수 없습니다");
    const [v] = await tx.update(vessels).set(patch).where(eq(vessels.id, vesselId)).returning();
    await audit({ tenantId, actorUserId, action: "vessel.update", targetType: "vessel", targetId: v.id, before, after: v }, tx);
    return v;
  });
}
