"use server";
import { requireTenantContext } from "@/lib/auth/context";
import { run } from "@/lib/action";
import type { ActionResult } from "@/lib/errors";
import { toggleRoundSubscription } from "@/services/union";

/** 회차 알림 구독 토글 — 노조 본인 데이터(round_subscriptions). 역할 검사는 서비스에서 직접 수행 */
export async function toggleSubscriptionAction(code: string, roundId: string): Promise<ActionResult<{ subscribed: boolean }>> {
  return run(async () => {
    const ctx = await requireTenantContext(code);
    const r = await toggleRoundSubscription(ctx, roundId);
    return { subscribed: r.subscribed };
  });
}
