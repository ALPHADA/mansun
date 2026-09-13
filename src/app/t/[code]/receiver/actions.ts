"use server";
import { z } from "zod";
import { requirePermission, type TenantContext } from "@/lib/auth/context";
import { run } from "@/lib/action";
import { forbidden, notFound, stateError, validation, type ActionResult } from "@/lib/errors";
import { createIntake, confirmIntake, addLot, updateLot, removeLot, deleteDraftIntake, getIntake, savePhoto, type LotInput } from "@/services/intake";
import { createVessel } from "@/services/vessel";
import type { CreateIntakePayload } from "@/lib/offline-queue";

const lotSchema = z.object({
  tankNo: z.string().max(20).optional().nullable(),
  speciesCode: z.string().min(1, "어종을 선택하세요"),
  weightKg: z.number().positive("중량은 0보다 커야 합니다"),
  unit: z.enum(["kg", "box", "ea"]),
  quantity: z.number().positive().optional().nullable(),
  grade: z.enum(["A", "B", "C"]),
  note: z.string().max(100, "참고사항은 100자 이내").optional().nullable(),
  photos: z.array(z.string().startsWith("/api/uploads/", "사진 경로가 올바르지 않습니다")).max(10, "사진은 10장 이내").default([]),
});
const intakeSchema = z.object({
  clientRef: z.string().min(8).max(64),
  vesselId: z.string().uuid("선박을 선택하세요"),
  arrivedAt: z.string().datetime({ offset: true }),
  roundId: z.string().uuid().nullable(),
  note: z.string().max(200).optional().nullable(),
  items: z.array(lotSchema).min(1, "품목을 1개 이상 입력하세요"),
});

/** 본인 입고(draft)만 수정 — operator/admin 은 정정 권한으로 통과 */
async function assertEditable(ctx: TenantContext, intakeId: string) {
  const it = await getIntake(ctx.tenant.id, intakeId);
  if (!it) throw notFound("입고를 찾을 수 없습니다");
  const isStaff = ctx.roles.some((r) => r === "admin" || r === "operator");
  if (it.intake.status !== "draft" && !isStaff) throw stateError("확정된 입고는 운영자 정정이 필요합니다");
  if (it.intake.createdBy !== ctx.session.userId && !isStaff) throw forbidden("본인이 등록한 입고만 수정할 수 있습니다");
  return it;
}

export async function createIntakeAction(code: string, payload: CreateIntakePayload): Promise<ActionResult<{ id: string; duplicate: boolean }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const v = intakeSchema.parse(payload);
    return createIntake(ctx, { vesselId: v.vesselId, arrivedAt: new Date(v.arrivedAt), roundId: v.roundId, note: v.note ?? null, clientRef: v.clientRef, items: v.items });
  }, "입고를 저장했습니다");
}

export async function confirmIntakeAction(code: string, intakeId: string, roundId?: string | null): Promise<ActionResult<{ lots: number; roundLabel: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.confirm");
    await assertEditable(ctx, intakeId);
    const r = await confirmIntake(ctx, intakeId, roundId ?? undefined);
    return { lots: r.lots, roundLabel: r.roundLabel };
  }, "입고를 확정했습니다");
}

const vesselSchema = z.object({ name: z.string().trim().min(2, "선박명은 2자 이상").max(30, "선박명은 30자 이내"), registrationNo: z.string().trim().max(30).optional().nullable(), shipperUserId: z.string().uuid("선주를 선택하세요") });
export async function createVesselAction(code: string, input: { name: string; registrationNo?: string | null; shipperUserId: string }): Promise<ActionResult<{ id: string; name: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const v = vesselSchema.parse(input);
    const vessel = await createVessel(ctx.tenant.id, ctx.session.userId, { name: v.name, registrationNo: v.registrationNo || null, shipperUserId: v.shipperUserId });
    return { id: vessel.id, name: vessel.name };
  }, "선박을 등록했습니다");
}

export async function uploadPhotoAction(code: string, form: FormData): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw validation("사진 파일이 없습니다");
    if (!file.type.startsWith("image/")) throw validation("이미지 파일만 업로드할 수 있습니다");
    const url = await savePhoto(ctx.tenant.code, file);
    return { url };
  });
}

export async function addLotAction(code: string, intakeId: string, lot: LotInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    await assertEditable(ctx, intakeId);
    const a = await addLot(ctx, intakeId, lotSchema.parse(lot));
    return { id: a.id };
  }, "품목을 추가했습니다");
}

export async function updateLotAction(code: string, intakeId: string, auctionId: string, lot: LotInput): Promise<ActionResult<void>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    await assertEditable(ctx, intakeId);
    await updateLot(ctx, auctionId, lotSchema.parse(lot));
  }, "품목을 수정했습니다");
}

export async function removeLotAction(code: string, intakeId: string, auctionId: string): Promise<ActionResult<void>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    await assertEditable(ctx, intakeId);
    await removeLot(ctx, auctionId);
  }, "품목을 삭제했습니다");
}

export async function deleteDraftIntakeAction(code: string, intakeId: string): Promise<ActionResult<void>> {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    await deleteDraftIntake(ctx, intakeId);
  }, "입고를 삭제했습니다");
}
