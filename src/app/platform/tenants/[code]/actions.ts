"use server";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { setSessionCookie } from "@/lib/auth/session";
import { run } from "@/lib/action";
import { AppError, type ActionResult } from "@/lib/errors";
import { switchTenantAction } from "@/app/(auth)/actions";
import {
  changeTenantStatus, getTenantByCodeOrThrow, inviteInitialAdmin, startReadSession,
  type AdminInviteInput, type StatusNotifyTarget, type SuspendDuration, type TenantStatusAction,
} from "@/services/platform";

export async function tenantStatusAction(code: string, action: TenantStatusAction, opts: { reason?: string; duration?: SuspendDuration; notifyTarget?: StatusNotifyTarget }): Promise<ActionResult<{ status: string }>> {
  const labels: Record<TenantStatusAction, string> = { activate: "활성화했습니다", suspend: "정지했습니다", unsuspend: "정지를 해제했습니다", archive: "아카이브했습니다" };
  return run(async () => {
    const session = await requirePlatformAdmin();
    const tenant = await getTenantByCodeOrThrow(code);
    const t = await changeTenantStatus({ userId: session.userId, name: session.name }, tenant.id, action, opts);
    return { status: t.status };
  }, `수협을 ${labels[action]}`);
}

export async function reinviteAdminAction(code: string, input: AdminInviteInput): Promise<ActionResult<{ inviteLink: string; email: string }>> {
  return run(async () => {
    const session = await requirePlatformAdmin();
    const tenant = await getTenantByCodeOrThrow(code);
    const r = await inviteInitialAdmin({ userId: session.userId, name: session.name }, tenant.id, input);
    return { inviteLink: r.inviteLink, email: r.invitation.email };
  }, "초청 메일을 발송했습니다 (7일 유효)");
}

/** 분쟁 조회 모드 진입: 사유 기록(감사 로그) → Tenant 전환 → 읽기 전용 세션(readSessionId) */
export async function enterReadModeAction(code: string, reason: string): Promise<ActionResult<{ next: string }>> {
  return run(async () => {
    const session = await requirePlatformAdmin();
    const tenant = await getTenantByCodeOrThrow(code);
    const rs = await startReadSession({ userId: session.userId, name: session.name }, tenant.id, reason);
    const sw = await switchTenantAction(code);
    if (!sw.ok) throw new AppError(sw.code ?? "forbidden", sw.error);
    // Platform Admin 은 소속 여부와 무관하게 읽기 전용(activeRole=null) 으로 진입
    await setSessionCookie({ ...session, activeTenantId: tenant.id, activeTenantCode: tenant.code, activeRole: null, tenantRoles: [], readSessionId: rs.id });
    return { next: `/t/${code}/operator/dashboard` };
  }, "분쟁 조회 모드로 진입합니다 (읽기 전용 · 4시간)");
}
