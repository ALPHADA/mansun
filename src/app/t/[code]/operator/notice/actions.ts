"use server";
import { z } from "zod";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { fromLocalInput } from "@/lib/format";
import { sendNotice } from "@/services/notice";

const schema = z.object({
  roundId: z.string().min(1, "회차를 선택하세요"),
  title: z.string().trim().min(2, "제목은 2~40자").max(40, "제목은 2~40자"),
  message: z.string().trim().min(10, "메시지는 10~500자").max(500, "메시지는 10~500자"),
  targets: z.array(z.enum(["broker", "union", "staff", "shipper"])).min(1, "발송 대상을 1개 이상 선택하세요"),
  channels: z.array(z.enum(["inapp", "kakao", "sms", "email"])).min(1, "채널을 1개 이상 선택하세요"),
  bidStartAt: z.string().min(1, "입찰 시작을 입력하세요"),
  bidCloseAt: z.string().min(1, "입찰 마감을 입력하세요"),
  fieldStartAt: z.string().nullish(),
});
export type NoticeFormInput = z.input<typeof schema>;

export async function sendNoticeAction(code: string, input: NoticeFormInput) {
  return run(async () => {
    const ctx = await requirePermission(code, "notice.send");
    const v = schema.parse(input);
    const r = await sendNotice(ctx.tenant, ctx.session.userId, ctx.role, {
      roundId: v.roundId, title: v.title, message: v.message, targets: v.targets, channels: v.channels, mode: "manual",
      bidStartAt: fromLocalInput(v.bidStartAt), bidCloseAt: fromLocalInput(v.bidCloseAt),
      fieldStartAt: ctx.tenant.fieldAuctionEnabled && v.fieldStartAt ? fromLocalInput(v.fieldStartAt) : null,
    });
    return { recipientCount: r.recipientCount, successCount: r.successCount, failCount: r.failCount };
  });
}
