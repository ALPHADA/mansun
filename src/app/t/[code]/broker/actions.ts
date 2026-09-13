"use server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/auth/context";
import { run } from "@/lib/action";
import { stateError, type ActionResult } from "@/lib/errors";
import { placeBid } from "@/services/bid";
import { issueOtp } from "@/services/auth";
import { updateNotificationPrefs, changePassword } from "@/services/broker";
import type { NotificationPrefs } from "@/db/schema";

const bidSchema = z.object({
  price: z.number().int("입찰가는 정수").positive("입찰가는 1원 이상"),
  memo: z.string().max(50, "메모는 50자 이내").optional().nullable(),
  otp: z.string().optional().nullable(),
});

export async function placeBidAction(code: string, auctionId: string, input: { price: number; memo?: string | null; otp?: string | null })
  : Promise<ActionResult<{ bidId: string; modified: boolean; revision: number }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "bid.place");
    const v = bidSchema.parse(input);
    const r = await placeBid(ctx, auctionId, { price: v.price, memo: v.memo?.trim() || null, otp: v.otp?.trim() || null });
    return { bidId: r.bid.id, modified: r.modified, revision: r.bid.revision };
  }, "입찰이 접수되었습니다");
}

/** 입찰 OTP 발송 (Tenant.bidMfaRequired 일 때) */
export async function requestBidOtp(code: string): Promise<ActionResult<{ devCode: string | null }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "bid.place");
    const devCode = await issueOtp(`bid:${ctx.session.userId}`, "bid", ctx.session.userId);
    return { devCode };
  }, "인증번호를 발송했습니다");
}

const prefsSchema = z.object({ inapp: z.boolean(), kakao: z.boolean(), sms: z.boolean(), email: z.boolean(), lostBidInapp: z.boolean() });

export async function saveNotificationPrefs(code: string, prefs: NotificationPrefs): Promise<ActionResult<NotificationPrefs>> {
  return run(async () => {
    const ctx = await requireTenantContext(code);
    if (ctx.readOnly || !ctx.membershipId) throw stateError("읽기 전용 상태에서는 변경할 수 없습니다");
    return updateNotificationPrefs(ctx, prefsSchema.parse(prefs));
  }, "알림 설정을 저장했습니다");
}

const pwSchema = z.object({
  current: z.string().min(1, "현재 비밀번호를 입력하세요"),
  next: z.string().min(8, "새 비밀번호는 8자 이상"),
  confirm: z.string(),
}).refine((d) => d.next === d.confirm, { message: "새 비밀번호가 일치하지 않습니다", path: ["confirm"] });

export async function changePasswordAction(code: string, input: { current: string; next: string; confirm: string }): Promise<ActionResult<void>> {
  return run(async () => {
    const ctx = await requireTenantContext(code);
    const v = pwSchema.parse(input);
    await changePassword(ctx.session.userId, v.current, v.next);
  }, "비밀번호를 변경했습니다");
}
