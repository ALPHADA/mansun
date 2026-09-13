"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, selectTenant, acceptInvitation, getInvitation, issueOtp } from "@/services/auth";
import { clearSessionCookie, getSession } from "@/lib/auth/session";
import { toActionError, type ActionResult } from "@/lib/errors";
import { audit } from "@/services/audit";

const loginSchema = z.object({ identifier: z.string().min(3, "이메일 또는 전화번호를 입력하세요"), password: z.string().min(4, "비밀번호를 입력하세요"), next: z.string().optional() });

export async function loginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  let next = "/";
  try {
    const input = loginSchema.parse(Object.fromEntries(form));
    const r = await login(input.identifier, input.password);
    next = input.next && input.next.startsWith("/") && r.next !== "/select-tenant" ? input.next : r.next;
  } catch (e) { return toActionError(e); }
  redirect(next);
}

export async function switchTenantAction(code: string): Promise<ActionResult<{ next: string }>> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "로그인이 필요합니다", code: "unauthorized" };
    const r = await selectTenant(session, code);
    return { ok: true, data: r };
  } catch (e) { return toActionError(e); }
}

export async function selectTenantFormAction(form: FormData) {
  const code = String(form.get("code") ?? "");
  const next = String(form.get("next") ?? "");
  const session = await getSession();
  if (!session) redirect("/login");
  const r = await selectTenant(session, code);
  redirect(next && next.startsWith(`/t/${code}`) ? next : r.next);
}

export async function logoutAction() {
  const s = await getSession();
  if (s) await audit({ action: "auth.logout", actorUserId: s.userId, tenantId: s.activeTenantId });
  await clearSessionCookie();
  redirect("/login");
}

export async function requestInviteOtpAction(token: string): Promise<ActionResult<{ devCode: string | null }>> {
  try {
    const inv = await getInvitation(token);
    if (!inv) return { ok: false, error: "유효하지 않은 초청입니다" };
    const devCode = await issueOtp(inv.inv.email, "invite", null);
    return { ok: true, data: { devCode }, message: "인증번호를 발송했습니다" };
  } catch (e) { return toActionError(e); }
}

const acceptSchema = z.object({
  token: z.string(), password: z.string().min(8, "비밀번호는 8자 이상"), passwordConfirm: z.string(),
  phone: z.string().optional(), otp: z.string().length(6, "인증번호 6자리"),
}).refine((d) => d.password === d.passwordConfirm, { message: "비밀번호가 일치하지 않습니다", path: ["passwordConfirm"] });

export async function acceptInviteAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const input = acceptSchema.parse(Object.fromEntries(form));
    await acceptInvitation(input.token, input);
  } catch (e) { return toActionError(e); }
  redirect("/login?joined=1");
}
