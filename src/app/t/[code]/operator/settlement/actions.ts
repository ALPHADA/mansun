"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { confirmRoundSettlements, generateSettlements, markPaid } from "@/services/settlement";

export async function generateSettlementsAction(code: string, roundId: string) {
  return run(async () => {
    const ctx = await requirePermission(code, "settlement.process");
    return generateSettlements(ctx, roundId);
  });
}

export async function confirmRoundSettlementsAction(code: string, roundId: string) {
  return run(async () => {
    const ctx = await requirePermission(code, "settlement.process");
    return confirmRoundSettlements(ctx, roundId);
  });
}

export async function markPaidAction(code: string, settlementId: string) {
  return run(async () => {
    const ctx = await requirePermission(code, "settlement.process");
    await markPaid(ctx, settlementId);
  }, "지급 완료 처리되었습니다");
}
