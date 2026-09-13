"use server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { run } from "@/lib/action";
import { stateError, type ActionResult } from "@/lib/errors";
import { raiseObjection } from "@/services/auction";
import { updateMyProfile, updateMyNotificationPrefs, changeMyPassword } from "@/services/shipper";
import type { NotificationPrefs } from "@/db/schema";

/** 선주 이의 제기 (UC-05 분쟁 트리거) — 본인 물품 · 낙찰/유찰 후 24시간 이내 */
export async function raiseObjectionAction(code: string, auctionId: string, reason: string): Promise<ActionResult<{ disputeId: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "dispute.raise");
    const d = await raiseObjection(ctx, auctionId, reason);
    return { disputeId: d.id };
  }, "이의 제기가 접수되었습니다. 운영자가 검토 후 결과를 알려드립니다");
}

const profileSchema = z.object({
  phone: z.string().max(20).optional(),
  bankAccount: z.string().max(60, "입금 계좌는 60자 이내").optional(),
});
export async function updateProfileAction(code: string, input: { phone?: string; bankAccount?: string }): Promise<ActionResult<{ phone: string | null; bankAccount: string | null }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "shipper.read_self", { write: false });
    if (ctx.readOnly) throw stateError("읽기 전용 상태에서는 변경할 수 없습니다");
    const v = profileSchema.parse(input);
    return updateMyProfile(ctx, { phone: v.phone, bankAccount: v.bankAccount });
  }, "프로필을 저장했습니다");
}

const prefsSchema = z.object({ inapp: z.boolean(), kakao: z.boolean(), sms: z.boolean(), email: z.boolean(), lostBidInapp: z.boolean() }).partial();
export async function updatePrefsAction(code: string, prefs: Partial<NotificationPrefs>): Promise<ActionResult<NotificationPrefs>> {
  return run(async () => {
    const ctx = await requirePermission(code, "shipper.read_self", { write: false });
    if (ctx.readOnly) throw stateError("읽기 전용 상태에서는 변경할 수 없습니다");
    return updateMyNotificationPrefs(ctx, prefsSchema.parse(prefs));
  }, "알림 설정을 저장했습니다");
}

const pwSchema = z.object({
  current: z.string().min(1, "현재 비밀번호를 입력하세요"),
  next: z.string().min(8, "새 비밀번호는 8자 이상"),
  confirm: z.string(),
}).refine((d) => d.next === d.confirm, { message: "새 비밀번호가 일치하지 않습니다", path: ["confirm"] });
export async function changePasswordAction(code: string, input: { current: string; next: string; confirm: string }): Promise<ActionResult<void>> {
  return run(async () => {
    const ctx = await requirePermission(code, "shipper.read_self", { write: false });
    const v = pwSchema.parse(input);
    await changeMyPassword(ctx, v.current, v.next);
  }, "비밀번호를 변경했습니다");
}
