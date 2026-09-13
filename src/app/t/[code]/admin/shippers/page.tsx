import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listShippers, listVessels } from "@/services/vessel";
import { ShippersClient, type ShipperItem, type VesselItem } from "./ShippersClient";

export const metadata = { title: "선주 등록" };

export default async function ShippersPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "members.manage")) notFound();
  const [shippers, vessels] = await Promise.all([listShippers(ctx.tenant.id), listVessels(ctx.tenant.id, { includeInactive: true })]);
  const canWrite = !ctx.readOnly && hasPermission(ctx, "members.manage");
  const items: ShipperItem[] = shippers.map((s) => ({ userId: s.userId, name: s.name, phone: s.phone, email: s.email, membershipId: s.membershipId, status: s.status, bankAccount: s.bankAccount, joinedAt: s.joinedAt?.toISOString() ?? null }));
  const vs: VesselItem[] = vessels.map((v) => ({ id: v.id, name: v.name, registrationNo: v.registrationNo, shipperUserId: v.shipperUserId, active: v.active }));
  return <ShippersClient code={code} shippers={items} vessels={vs} canWrite={canWrite} />;
}
