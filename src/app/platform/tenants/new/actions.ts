"use server";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { run } from "@/lib/action";
import type { ActionResult } from "@/lib/errors";
import { createTenant, type TenantCreateInput } from "@/services/platform";

export async function createTenantAction(input: TenantCreateInput): Promise<ActionResult<{ code: string; name: string; inviteLink: string; adminEmail: string }>> {
  return run(async () => {
    const session = await requirePlatformAdmin();
    const r = await createTenant({ userId: session.userId, name: session.name }, input);
    return { code: r.tenant.code, name: r.tenant.name, inviteLink: r.inviteLink, adminEmail: input.adminEmail };
  }, "수협이 준비중(pending) 상태로 생성되고 초기 Admin 초청 메일이 발송되었습니다");
}
