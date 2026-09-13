"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { NotificationPrefs } from "@/db/schema";
import { updateProfileAction, updatePrefsAction, changePasswordAction } from "../actions";

/** 인라인 편집 필드 (전화 / 입금계좌) */
export function InlineEditField({ code, field, label, initial, placeholder, readOnly, hint }: { code: string; field: "phone" | "bankAccount"; label: string; initial: string; placeholder?: string; readOnly: boolean; hint?: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = () => start(async () => {
    const r = await updateProfileAction(code, { [field]: value });
    if (!r.ok) { setError(r.fieldErrors?.[field] ?? r.error); return; }
    toast(r.message ?? "저장됨");
    setEditing(false); setError(null);
    router.refresh();
  });
  if (!editing) {
    return (
      <div className="detail-row">
        <span className="label">{label}</span>
        <span className="value flex" style={{ gap: 8 }}>{initial || <span className="muted">미등록</span>}{!readOnly && <button type="button" className="btn-ghost small" style={{ padding: "2px 6px" }} onClick={() => setEditing(true)}>수정</button>}</span>
      </div>
    );
  }
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--color-bg)" }}>
      <label>{label}</label>
      <div className="inline-edit">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus disabled={pending} />
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>{pending ? <span className="spinner" /> : "저장"}</button>
        <button type="button" className="btn-secondary" onClick={() => { setEditing(false); setValue(initial); setError(null); }} disabled={pending}>취소</button>
      </div>
      {error ? <div className="text-danger small mt-8">{error}</div> : hint ? <div className="muted small mt-8">{hint}</div> : null}
    </div>
  );
}

const PREF_ITEMS: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  { key: "inapp", label: "인앱 알림", desc: "본인 선박 입고 등록 · 경매 시작 공지 · 입금 완료" },
  { key: "kakao", label: "카카오 알림톡", desc: "경매 시작 공지 (낙찰·유찰·이의제기 결과는 항상 발송)" },
  { key: "sms", label: "SMS", desc: "알림톡 실패 시 대체 발송" },
  { key: "email", label: "이메일", desc: "정산 확정 안내 · 정산서 발급" },
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
      const r = await updatePrefsAction(code, { [key]: next[key] });
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
      <div className="mandatory-note">🔒 <b>본인 출하 낙찰 · 유찰 · 이의 제기 처리 결과</b>는 필수 알림으로 채널 설정과 무관하게 항상 발송됩니다 (옵트아웃 불가).</div>
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
