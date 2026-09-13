"use client";
import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action}>
      {next && <input type="hidden" name="next" value={next} />}
      {state && !state.ok && <div className="form-error">{state.error}</div>}
      <div className="field">
        <label htmlFor="identifier">이메일 또는 전화번호</label>
        <input id="identifier" name="identifier" autoComplete="username" placeholder="operator@gangu.kr" required />
      </div>
      <div className="field">
        <label htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn-primary btn-block" disabled={pending}>{pending ? <span className="spinner" /> : "로그인"}</button>
    </form>
  );
}
