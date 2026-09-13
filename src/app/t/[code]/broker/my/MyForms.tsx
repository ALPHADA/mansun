"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { NotificationPrefs } from "@/db/schema";
import { saveNotificationPrefs, changePasswordAction } from "../actions";

const PREF_ITEMS: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  { key: "inapp", label: "인앱 알림", desc: "새 경매 공지 · 마감 임박 · 정산서 발급" },
  { key: "kakao", label: "카카오 알림톡", desc: "새 경매 공지 · 면허 만료 임박" },
  { key: "sms", label: "SMS", desc: "알림톡 실패 시 대체 발송" },
  { key: "email", label: "이메일", desc: "정산서 발급 안내" },
  { key: "lostBidInapp", label: "패찰 인앱 알림", desc: "개찰 후 패찰 결과 인앱 통보" },
];

export function NotificationPrefsForm({ code, initial, readOnly }: { code: string; initial: NotificationPrefs; readOnly: boolean }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const toggle = (key: keyof NotificationPrefs) => {
    if (readOnly) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    start(async () => {
      const r = await saveNotificationPrefs(code, next);
      if (!r.ok) { setPrefs(prefs); toast(r.error); return; }
      toast(r.message ?? "저장됨");
      router.refresh();
    });
  };

  return (
    <div>
      {PREF_ITEMS.map((it) => (
        <div key={it.key} className="pref-row">
          <div><div>{it.label}</div><div className="desc">{it.desc}</div></div>
          <button type="button" className={`switch${prefs[it.key] ? " on" : ""}`} role="switch" aria-checked={prefs[it.key]} aria-label={it.label} onClick={() => toggle(it.key)} disabled={pending || readOnly} />
        </div>
      ))}
    </div>
  );
}

export function PasswordForm({ code }: { code: string }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) { setError("새 비밀번호가 일치하지 않습니다"); return; }
    if (form.next.length < 8) { setError("새 비밀번호는 8자 이상"); return; }
    setError(null);
    start(async () => {
      const r = await changePasswordAction(code, form);
      if (!r.ok) { setError(r.error); return; }
      toast(r.message ?? "변경됨");
      setForm({ current: "", next: "", confirm: "" });
    });
  };

  return (
    <form onSubmit={submit} className="stack-form">
      <div><label>현재 비밀번호</label><input type="password" autoComplete="current-password" value={form.current} onChange={set("current")} required /></div>
      <div><label>새 비밀번호 (8자 이상)</label><input type="password" autoComplete="new-password" value={form.next} onChange={set("next")} minLength={8} required /></div>
      <div><label>새 비밀번호 확인</label><input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required /></div>
      {error && <div className="text-danger small">{error}</div>}
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? <span className="spinner" /> : "비밀번호 변경"}</button>
    </form>
  );
}
