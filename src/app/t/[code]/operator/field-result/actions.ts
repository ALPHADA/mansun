"use server";
import { z } from "zod";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { enterFieldResult } from "@/services/auction";

const schema = z.object({
  price: z.coerce.number().int("현장 최고가는 정수(원)").positive("현장 최고가는 0보다 커야 합니다"),
  winnerMembershipId: z.string().min(1, "현장 낙찰자를 선택하세요"),
  note: z.string().trim().max(100, "비고는 100자 이내").nullish(),
});

export interface FieldResultOutcome {
  status: string; digitalHighPrice: number | null; fieldHighPrice: number | null; finalPrice: number | null;
  awardSource: "digital" | "field" | "none" | null; winnerMembershipId: string | null; reservePrice: number | null;
}

export async function enterFieldResultAction(code: string, auctionId: string, input: z.input<typeof schema>) {
  return run(async () => {
    const ctx = await requirePermission(code, "auction.field_result");
    const v = schema.parse(input);
    const detail = await enterFieldResult(ctx, auctionId, { price: v.price, winnerMembershipId: v.winnerMembershipId, note: v.note || null });
    const a = detail?.auction;
    const out: FieldResultOutcome = {
      status: a?.status ?? "unknown", digitalHighPrice: a?.digitalHighPrice ?? null, fieldHighPrice: a?.fieldHighPrice ?? null, finalPrice: a?.finalPrice ?? null,
      awardSource: a?.awardSource ?? null, winnerMembershipId: a?.winnerMembershipId ?? null, reservePrice: a?.reservePrice ?? null,
    };
    return out;
  }, "현장 결과 입력 완료 · 개찰되었습니다");
}
