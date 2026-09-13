"use server";
import { z } from "zod";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { fromLocalInput } from "@/lib/format";
import { validation } from "@/lib/errors";
import { addLot, confirmIntake, createIntake, deleteDraftIntake, removeLot, savePhoto, updateIntakeHeader, updateLot, type LotInput } from "@/services/intake";
import { createVessel } from "@/services/vessel";

const lotSchema = z.object({
  tankNo: z.string().trim().max(20, "물탱크 번호는 20자 이내").nullish(),
  speciesCode: z.string().min(1, "어종을 선택하세요"),
  weightKg: z.coerce.number().positive("중량은 0보다 커야 합니다"),
  unit: z.enum(["kg", "box", "ea"]),
  quantity: z.coerce.number().positive("수량은 0보다 커야 합니다").nullish(),
  grade: z.enum(["A", "B", "C"]),
  note: z.string().trim().max(100, "참고사항은 100자 이내").nullish(),
  photos: z.array(z.string()).max(10, "사진은 10장 이내").optional(),
});
export type LotFormInput = z.input<typeof lotSchema>;

const headerSchema = z.object({
  vesselId: z.string().min(1, "선박을 선택하세요"),
  arrivedAt: z.string().min(1, "도착 시각을 입력하세요"),
  roundId: z.string().nullish(),
  note: z.string().trim().max(200).nullish(),
});
export type HeaderFormInput = z.input<typeof headerSchema>;

const toLot = (l: z.output<typeof lotSchema>): LotInput => ({
  tankNo: l.tankNo || null, speciesCode: l.speciesCode, weightKg: l.weightKg, unit: l.unit,
  quantity: l.unit === "kg" ? null : l.quantity ?? null, grade: l.grade, note: l.note || null, photos: l.photos ?? [],
});

export async function createIntakeAction(code: string, header: HeaderFormInput, items: LotFormInput[]) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const h = headerSchema.parse(header);
    const lots = items.map((i) => toLot(lotSchema.parse(i)));
    const r = await createIntake(ctx, { vesselId: h.vesselId, arrivedAt: fromLocalInput(h.arrivedAt), roundId: h.roundId || null, note: h.note || null, items: lots });
    return r.id;
  }, "입고가 등록되었습니다");
}

export async function updateIntakeHeaderAction(code: string, intakeId: string, header: HeaderFormInput) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const h = headerSchema.parse(header);
    await updateIntakeHeader(ctx, intakeId, { vesselId: h.vesselId, arrivedAt: fromLocalInput(h.arrivedAt), roundId: h.roundId || null, note: h.note || null });
  }, "선박 정보가 저장되었습니다");
}

export async function addLotAction(code: string, intakeId: string, lot: LotFormInput) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const a = await addLot(ctx, intakeId, toLot(lotSchema.parse(lot)));
    return a.id;
  }, "품목이 추가되었습니다");
}

const lotPatchSchema = lotSchema.partial();
export type LotPatchInput = z.input<typeof lotPatchSchema>;

export async function updateLotAction(code: string, auctionId: string, lot: LotPatchInput, reason?: string) {
  return run(async () => {
    const ctx = await requirePermission(code, reason ? "intake.correct" : "intake.write");
    if (reason !== undefined && reason.trim().length < 2) throw validation("정정 사유를 입력하세요");
    const p = lotPatchSchema.parse(lot);
    const patch: Partial<LotInput> = {
      ...(p.tankNo !== undefined ? { tankNo: p.tankNo || null } : {}),
      ...(p.speciesCode !== undefined ? { speciesCode: p.speciesCode } : {}),
      ...(p.weightKg !== undefined ? { weightKg: p.weightKg } : {}),
      ...(p.unit !== undefined ? { unit: p.unit } : {}),
      ...(p.quantity !== undefined ? { quantity: p.quantity ?? null } : {}),
      ...(p.grade !== undefined ? { grade: p.grade } : {}),
      ...(p.note !== undefined ? { note: p.note || null } : {}),
      ...(p.photos !== undefined ? { photos: p.photos } : {}),
    };
    await updateLot(ctx, auctionId, patch, reason?.trim());
  }, reason ? "품목이 정정되었습니다" : "품목이 수정되었습니다");
}

export async function removeLotAction(code: string, auctionId: string, reason?: string) {
  return run(async () => {
    const ctx = await requirePermission(code, reason ? "intake.correct" : "intake.write");
    if (reason !== undefined && reason.trim().length < 2) throw validation("취소 사유를 입력하세요");
    await removeLot(ctx, auctionId, reason?.trim());
  }, reason ? "품목이 취소되었습니다" : "품목이 삭제되었습니다");
}

export async function confirmIntakeAction(code: string, intakeId: string, roundId?: string | null) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.confirm");
    const r = await confirmIntake(ctx, intakeId, roundId ?? undefined);
    return { lots: r.lots, roundLabel: r.roundLabel };
  }, "입고가 확정되었습니다 · 경매번호가 부여되었습니다");
}

export async function deleteDraftIntakeAction(code: string, intakeId: string) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    await deleteDraftIntake(ctx, intakeId);
  }, "입고가 삭제되었습니다");
}

const vesselSchema = z.object({
  name: z.string().trim().min(2, "선박명은 2자 이상"),
  shipperUserId: z.string().min(1, "선주를 선택하세요"),
  registrationNo: z.string().trim().max(30).nullish(),
});
export async function createVesselAction(code: string, input: z.input<typeof vesselSchema>) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const v = vesselSchema.parse(input);
    const created = await createVessel(ctx.tenant.id, ctx.session.userId, { name: v.name, shipperUserId: v.shipperUserId, registrationNo: v.registrationNo || null });
    return { id: created.id, name: created.name };
  }, "선박이 등록되었습니다");
}

/** 사진 업로드 — FormData `photos` (multiple). 저장 경로 배열 반환 */
export async function uploadPhotosAction(code: string, form: FormData) {
  return run(async () => {
    const ctx = await requirePermission(code, "intake.write");
    const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw validation("업로드할 사진이 없습니다");
    const paths: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) throw validation("이미지 파일만 첨부할 수 있습니다");
      paths.push(await savePhoto(ctx.tenant.code, f));
    }
    return paths;
  }, "사진이 첨부되었습니다");
}
