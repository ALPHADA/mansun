"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { registerShipper, updateShipper, type ShipperInput } from "@/services/tenant-admin";
import { createVessel, updateVessel } from "@/services/vessel";
import type { ActionResult } from "@/lib/errors";

export async function registerShipperAction(code: string, input: ShipperInput): Promise<ActionResult<{ userId: string; tempPassword: string | null }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    const r = await registerShipper(ctx, input);
    return { userId: r.userId, tempPassword: r.tempPassword };
  }, "선주를 등록했습니다");
}

export async function updateShipperAction(code: string, userId: string, input: { phone?: string; bankAccount?: string }): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    await updateShipper(ctx, userId, input);
    return undefined;
  }, "선주 정보를 수정했습니다");
}

export async function createVesselAction(code: string, input: { name: string; registrationNo?: string; shipperUserId: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    const v = await createVessel(ctx.tenant.id, ctx.session.userId, { name: input.name, registrationNo: input.registrationNo || null, shipperUserId: input.shipperUserId });
    return { id: v.id };
  }, "선박을 등록했습니다");
}

export async function setVesselActiveAction(code: string, vesselId: string, active: boolean): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    await updateVessel(ctx.tenant.id, ctx.session.userId, vesselId, { active });
    return undefined;
  }, active ? "선박을 활성화했습니다" : "선박을 비활성화했습니다");
}
