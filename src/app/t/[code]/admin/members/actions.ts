"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { inviteMember, resendInvitation, cancelInvitation, setMembershipStatus, addRoleToUser, type InviteInput } from "@/services/tenant-admin";
import type { ActionResult } from "@/lib/errors";
import type { Role } from "@/db/schema";

export async function inviteMemberAction(code: string, input: InviteInput): Promise<ActionResult<{ inviteLink: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    const r = await inviteMember(ctx, input);
    return { inviteLink: r.inviteLink };
  }, "초청 메일을 발송했습니다");
}

export async function resendInvitationAction(code: string, id: string): Promise<ActionResult<{ inviteLink: string }>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    const r = await resendInvitation(ctx, id);
    return { inviteLink: r.inviteLink };
  }, "초청을 재발송했습니다 (7일 연장)");
}

export async function cancelInvitationAction(code: string, id: string): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    await cancelInvitation(ctx, id);
    return undefined;
  }, "초청을 취소했습니다");
}

export async function setMembershipStatusAction(code: string, membershipId: string, status: "active" | "suspended", reason?: string): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    await setMembershipStatus(ctx, membershipId, status, reason);
    return undefined;
  }, status === "suspended" ? "정지했습니다" : "활성화했습니다");
}

export async function addRoleAction(code: string, userId: string, role: Role, licenseNo?: string): Promise<ActionResult<undefined>> {
  return run(async () => {
    const ctx = await requirePermission(code, "members.manage");
    await addRoleToUser(ctx, userId, role, licenseNo);
    return undefined;
  }, "역할을 추가했습니다");
}
