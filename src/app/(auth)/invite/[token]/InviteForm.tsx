"use client";
import { useActionState, useState, useTransition } from "react";
import { acceptInviteAction, requestInviteOtpAction } from "../../actions";

export function InviteForm({ token, name, email, phone, licenseNo }: { token: string; name: string; email: string; phone: string; licenseNo: string | null }) {
  const [state, action, pending] = useActionState(acceptInviteAction, null);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [sending, start] = useTransition();
  const sendOtp = () => start(async () => {
    const r = await requestInviteOtpAction(token);
    setOtpMsg(r.ok ? `인증번호를 발송했습니다${r.data?.devCode ? ` (개발용: ${r.data.devCode})` : ""}` : r.error);
  });
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      {state && !state.ok && <div className="form-error">{state.error}</div>}
      <div className="field"><label>이름</label><input value={name} disabled /></div>
      <div className="field"><label>이메일</label><input value={email} disabled /></div>
      {licenseNo && <div className="field"><label>면허번호</label><input value={licenseNo} disabled /></div>}
      <div className="field"><label>전화번호</label><input name="phone" defaultValue={phone} placeholder="01012345678" /></div>
      <div className="field"><label>비밀번호 (8자 이상)</label><input name="password" type="password" autoComplete="new-password" required />{fe.password && <div className="error">{fe.password}</div>}</div>
      <div className="field"><label>비밀번호 확인</label><input name="passwordConfirm" type="password" autoComplete="new-password" required />{fe.passwordConfirm && <div className="error">{fe.passwordConfirm}</div>}</div>
      <div className="field">
        <label>본인 인증번호</label>
        <div className="flex">
          <input name="otp" inputMode="numeric" maxLength={6} placeholder="6자리" required />
          <button type="button" className="btn-secondary" onClick={sendOtp} disabled={sending} style={{ whiteSpace: "nowrap" }}>{sending ? "발송중" : "인증번호 받기"}</button>
        </div>
        {otpMsg && <div className="small muted mt-8">{otpMsg}</div>}
      </div>
      <button className="btn-primary btn-block" disabled={pending}>{pending ? <span className="spinner" /> : "가입 완료"}</button>
    </form>
  );
}
