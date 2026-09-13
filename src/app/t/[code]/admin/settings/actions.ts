"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { updateTenantSettings, type SettingsSection } from "@/services/tenant-admin";
import type { ActionResult } from "@/lib/errors";

export async function saveSettingsAction(code: string, section: SettingsSection, patch: unknown): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "tenant.settings.write");
    await updateTenantSettings(ctx, section, patch);
    return undefined;
  }, "저장했습니다");
}
