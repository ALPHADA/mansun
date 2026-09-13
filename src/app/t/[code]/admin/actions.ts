"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { decideDispute } from "@/services/auction";
import type { ActionResult } from "@/lib/errors";

export async function decideDisputeAction(code: string, disputeId: string, approve: boolean, note?: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "auction.reauction.approve");
    const d = await decideDispute(ctx, disputeId, approve, note?.trim() || undefined);
    return { id: d.id };
  }, approve ? "승인했습니다. 재개찰 대기 상태로 전환됩니다" : "거부했습니다. 기존 결과가 유지됩니다");
}
