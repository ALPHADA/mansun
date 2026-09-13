"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { updateLicense, type LicenseInput } from "@/services/tenant-admin";
import type { ActionResult } from "@/lib/errors";

export async function updateLicenseAction(code: string, membershipId: string, input: LicenseInput, reason?: string): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    await updateLicense(ctx, membershipId, input, reason?.trim() || null);
    return undefined;
  }, "면허 정보를 변경했습니다");
}
