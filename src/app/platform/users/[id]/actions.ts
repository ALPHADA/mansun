"use server";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { run } from "@/lib/action";
import type { ActionResult } from "@/lib/errors";
import { setUserGlobalSuspended } from "@/services/platform";

export async function setGlobalSuspendedAction(userId: string, suspended: boolean, reason: string): Promise<ActionResult<{ restored: number; suspended: number }>> {
  return run(async () => {
    const session = await requirePlatformAdmin();
    return setUserGlobalSuspended({ userId: session.userId, name: session.name }, userId, suspended, reason);
  }, suspended ? "사용자를 글로벌 정지했습니다 (모든 수협 Membership 정지)" : "글로벌 정지를 해제했습니다");
}
