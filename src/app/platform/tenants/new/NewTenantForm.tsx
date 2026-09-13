"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { createTenantAction } from "./actions";
import type { TenantCreateInput } from "@/services/platform";

type Field = keyof TenantCreateInput;
const EMPTY: TenantCreateInput = { code: "", name: "", region: "", businessNo: "", address: "", contactEmail: "", contactPhone: "", adminName: "", adminEmail: "", adminPhone: "", adminTitle: "" };

const REGIONS = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"];

/** 클라이언트 측 1차 검증 (서버 zod 스키마와 동일 규칙) */
function validate(f: TenantCreateInput): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!/^[a-z][a-z0-9]{2,11}$/.test(f.code.trim())) e.code = "영소문자로 시작하는 영소문자·숫자 3~12자";
  if (f.name.trim().length < 2 || f.name.trim().length > 40) e.name = "2~40자";
  if (!f.region.trim()) e.region = "지역을 선택하세요";
  if (!/^\d{10}$/.test(f.businessNo.replace(/-/g, ""))) e.businessNo = "숫자 10자리";
  if (!f.address.trim()) e.address = "주소를 입력하세요";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.contactEmail.trim())) e.contactEmail = "이메일 형식";
  if (!/^\d{9,11}$/.test(f.contactPhone.replace(/-/g, ""))) e.contactPhone = "숫자 9~11자리 (하이픈 허용)";
  if (f.adminName.trim().length < 2) e.adminName = "2자 이상";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.adminEmail.trim())) e.adminEmail = "이메일 형식";
  if (f.adminPhone && f.adminPhone.trim() && !/^\d{10,11}$/.test(f.adminPhone.replace(/-/g, ""))) e.adminPhone = "숫자 10~11자리";
  return e;
}

export function NewTenantForm() {
  const [form, setForm] = useState<TenantCreateInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; name: string; inviteLink: string; adminEmail: string } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    if (touched[k]) setErrors(validate(next));
  };
  const blur = (k: Field) => () => { setTouched((t) => ({ ...t, [k]: true })); setErrors(validate(form)); };
  const err = (k: Field) => touched[k] ? errors[k] : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
    if (Object.keys(v).length) { setServerError("입력값을 확인하세요"); return; }
    setServerError(null);
    start(async () => {
      const r = await createTenantAction({ ...form, adminPhone: form.adminPhone?.trim() || undefined, adminTitle: form.adminTitle?.trim() || undefined });
      if (!r.ok) {
        setServerError(r.error);
        if (r.fieldErrors) setErrors((prev) => ({ ...prev, ...(r.fieldErrors as Partial<Record<Field, string>>) }));
        if (r.code === "conflict") setErrors((prev) => ({ ...prev, code: r.error }));
        return;
      }
      toast(r.message ?? "생성됨");
      if (r.data) setDone(r.data);
    });
  };

  if (done) {
    return (
      <div className="success-box">
        <h3>✅ {done.name} ({done.code}) 이(가) 준비중(pending) 상태로 생성되었습니다</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13 }}>초기 Admin <b>{done.adminEmail}</b> 에게 초청 메일이 발송되었습니다 (7일 유효). 초청 대상이 가입을 완료하면 상세 화면에서 <b>활성화</b>하세요.</p>
        {process.env.NODE_ENV !== "production" && (
          <div className="mb-16">
            <div className="small muted mb-8">개발 환경 — 초청 링크 (메일 Mock)</div>
            <div className="invite-link"><a href={done.inviteLink} target="_blank" rel="noreferrer">{typeof window !== "undefined" ? window.location.origin : ""}{done.inviteLink}</a></div>
          </div>
        )}
        <div className="flex">
          <Link href={`/platform/tenants/${done.code}`} className="btn-primary">수협 상세로 이동 →</Link>
          <button type="button" className="btn-secondary" onClick={() => { setDone(null); setForm(EMPTY); setTouched({}); setErrors({}); }}>다른 수협 등록</button>
        </div>
      </div>
    );
  }

  const input = (k: Field, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="field">
      <label htmlFor={`f-${k}`}>{label}{props.required !== false && <span className="text-danger"> *</span>}</label>
      <input id={`f-${k}`} value={form[k] ?? ""} onChange={set(k)} onBlur={blur(k)} className={err(k) ? "invalid" : undefined} {...props} />
      {err(k) ? <div className="field-error">{err(k)}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );

  return (
    <form className="pf-form" onSubmit={submit} data-dirty={form !== EMPTY ? "true" : undefined} noValidate>
      {serverError && <div className="form-error">{serverError}</div>}
      <fieldset>
        <legend>수협 정보</legend>
        <div className="form-grid">
          {input("code", "code (URL 식별자)", { placeholder: "gangu", autoComplete: "off", maxLength: 12, style: { fontFamily: "ui-monospace, Menlo, monospace" } }, "영소문자·숫자 3~12자, 유니크 · /t/{code}/… 로 사용")}
          {input("name", "이름", { placeholder: "강구항 수협", maxLength: 40 })}
          <div className="field">
            <label htmlFor="f-region">지역(광역시·도)<span className="text-danger"> *</span></label>
            <select id="f-region" value={form.region} onChange={set("region")} onBlur={blur("region")} className={err("region") ? "invalid" : undefined}>
              <option value="">선택</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {err("region") && <div className="field-error">{err("region")}</div>}
          </div>
          {input("businessNo", "사업자등록번호", { placeholder: "1234567890", inputMode: "numeric", maxLength: 12 }, "숫자 10자리")}
        </div>
        <div className="form-grid">
          {input("address", "위판장 주소", { placeholder: "경북 영덕군 강구면 강구항길 1" })}
        </div>
        <div className="form-grid">
          {input("contactEmail", "연락 이메일", { type: "email", placeholder: "ops@gangu.suhyup.kr" })}
          {input("contactPhone", "연락 전화", { type: "tel", placeholder: "054-733-0001" })}
        </div>
      </fieldset>

      <fieldset>
        <legend>초기 수협 Admin 초청</legend>
        <div className="hint mb-8">Tenant 생성과 동시에 초청 메일(7일 유효 1회용 링크)이 발송됩니다. 초청 대상이 가입하면 Membership(role=admin)이 생성되고, 그 뒤 활성화가 가능합니다.</div>
        <div className="form-grid">
          {input("adminName", "이름", { placeholder: "김위판" })}
          {input("adminEmail", "이메일", { type: "email", placeholder: "kim@gangu.suhyup.kr" })}
          {input("adminPhone", "전화번호", { type: "tel", placeholder: "010-0000-0000", required: false }, "OTP 발송용 (선택)")}
          {input("adminTitle", "직책", { placeholder: "위판과장", required: false, maxLength: 30 })}
        </div>
      </fieldset>

      <div className="hint mb-16">위판장 등록증(PDF) 첨부는 추후 지원 예정입니다. 기본 정책: 위판수수료 4% · 중매인수수료 1.5% · VAT 포함 · 회차 1개(06:30~07:00) — 활성화 후 수협 Admin 이 설정 화면에서 변경합니다.</div>

      <div className="form-actions">
        <Link href="/platform/tenants" className="btn-secondary">취소</Link>
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? <span className="spinner" /> : "생성 + 초청 메일 발송"}</button>
      </div>
    </form>
  );
}
