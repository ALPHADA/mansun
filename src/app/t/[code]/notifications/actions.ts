"use server";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/context";
import { markRead } from "@/services/notification";
import { selectTenant } from "@/services/auth";

export async function markAllReadAction(form: FormData) {
  const s = await requireSession();
  await markRead(s.userId, "all");
  redirect(`/t/${form.get("code")}/notifications`);
}
export async function markReadAction(form: FormData) {
  const s = await requireSession();
  const id = String(form.get("id")); const link = String(form.get("link") ?? ""); const tenantCode = String(form.get("tenantCode") ?? "");
  await markRead(s.userId, [id]);
  // 다른 Tenant 알림 → 자동 전환
  if (tenantCode && tenantCode !== s.activeTenantCode) {
    try { await selectTenant(s, tenantCode); } catch { /* 소속 아님 */ }
  }
  redirect(link && link.startsWith("/") ? link : `/t/${form.get("code")}/notifications`);
}
