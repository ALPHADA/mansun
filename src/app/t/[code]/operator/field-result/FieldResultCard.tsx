"use client";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { num, won } from "@/lib/format";
import { useAction } from "../_components/useAction";
import { enterFieldResultAction, type FieldResultOutcome } from "./actions";

export interface FieldAuction {
  id: string; auctionNo: string; speciesName: string; grade: string; weightKg: number; unit: string; quantity: number; bidCount: number;
  status: string; statusLabel: string; vesselName: string; digitalHighPrice: number | null; reservePrice: number | null;
  existingField: { price: number; winnerMembershipId: string; note: string | null } | null;
}
interface Props { code: string; a: FieldAuction; brokers: { membershipId: string; name: string; licenseNo: string | null }[]; showDigital: boolean; focus: boolean; canWrite: boolean }

export function FieldResultCard({ code, a, brokers, showDigital, focus, canWrite }: Props) {
  const { busy, call } = useAction();
  const [form, setForm] = useState({ price: a.existingField ? String(a.existingField.price) : "", winnerMembershipId: a.existingField?.winnerMembershipId ?? "", note: a.existingField?.note ?? "" });
  const [result, setResult] = useState<FieldResultOutcome | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: "center" }); }, [focus]);

  const brokerLabel = (id: string | null) => { const b = brokers.find((x) => x.membershipId === id); return b ? `${b.name}${b.licenseNo ? ` (${b.licenseNo})` : ""}` : "-"; };

  const submit = async () => {
    const r = await call(enterFieldResultAction(code, a.id, { price: Number(form.price), winnerMembershipId: form.winnerMembershipId, note: form.note || null }));
    if (r.ok) setResult(r.data);
  };

  if (result) {
    const fieldWon = result.awardSource === "field";
    return (
      <div className={`field-card${focus ? " focus" : ""}`} ref={ref}>
        <div className="head"><div><div className="no">{a.auctionNo}</div><div className="fish">{a.speciesName} <span className="muted small">{a.grade}등급</span></div></div>
          <Badge tone={result.status === "awarded" ? "success" : result.status === "passed" ? "danger" : "warning"}>{result.status === "awarded" ? "낙찰" : result.status === "passed" ? "유찰" : result.status === "rebid" ? "재입찰" : result.status}</Badge></div>
        <div className="compare-grid">
          <div className={`compare-cell${result.awardSource === "digital" ? " win" : ""}`}><div className="lbl">디지털 최고가</div><div className="val">{result.digitalHighPrice != null ? num(result.digitalHighPrice) : "없음"}</div></div>
          <div className={`compare-cell${fieldWon ? " win" : ""}`}><div className="lbl">현장 최고가</div><div className="val">{result.fieldHighPrice != null ? num(result.fieldHighPrice) : "-"}</div></div>
          <div className="compare-cell"><div className="lbl">최종 낙찰가</div><div className="val">{result.finalPrice != null ? num(result.finalPrice) : "-"}</div></div>
        </div>
        <div className="kv mt-8">
          <dt>낙찰 출처</dt><dd>{result.awardSource === "field" ? <Badge tone="warning">현장</Badge> : result.awardSource === "digital" ? <Badge tone="info">디지털</Badge> : <Badge tone="muted">유찰</Badge>}</dd>
          <dt>낙찰자</dt><dd>{result.awardSource === "none" ? "-" : brokerLabel(result.winnerMembershipId)}</dd>
          {result.status === "passed" && result.reservePrice != null && <><dt>최저가</dt><dd>{won(result.reservePrice)} 미달</dd></>}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>결과 통보가 낙찰자·패찰자·선주에게 전송되었습니다.</p>
      </div>
    );
  }

  return (
    <div className={`field-card${focus ? " focus" : ""}`} ref={ref}>
      <div className="head">
        <div><div className="no">{a.auctionNo}</div><div className="fish">{a.speciesName} <span className="muted small">{a.grade}등급</span></div></div>
        <Badge tone="warning">{a.statusLabel}</Badge>
      </div>
      <div className="meta">
        <span>{a.vesselName}</span><span>{num(a.weightKg, 1)}kg</span><span>{a.unit === "kg" ? "kg 단위" : `${num(a.quantity)}${a.unit === "box" ? "박스" : "마리"}`}</span><span>입찰자 {a.bidCount}명</span>
        {showDigital ? <span>디지털 최고가 <strong>{a.digitalHighPrice != null ? num(a.digitalHighPrice) : "없음"}</strong></span> : <span title="부정 방지: 입력 확정 후 공개">디지털가 🔒</span>}
        {a.reservePrice != null && <span>최저가 {num(a.reservePrice)}</span>}
      </div>
      {a.existingField && <div className="notice-box">기존 현장 결과 {num(a.existingField.price)}원 · {brokerLabel(a.existingField.winnerMembershipId)} — 다시 입력하면 덮어씁니다</div>}
      <div className="form-grid">
        <div><label>현장 최고가 (원/{a.unit === "kg" ? "kg" : a.unit === "box" ? "박스" : "마리"}) *</label>
          <input type="number" inputMode="numeric" min={1} step={1} value={form.price} placeholder="예: 8500" disabled={!canWrite || busy} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
        <div><label>현장 낙찰자 *</label>
          <select value={form.winnerMembershipId} disabled={!canWrite || busy} onChange={(e) => setForm((f) => ({ ...f, winnerMembershipId: e.target.value }))}>
            <option value="">중매인 선택</option>
            {brokers.map((b) => <option key={b.membershipId} value={b.membershipId}>{b.name}{b.licenseNo ? ` (${b.licenseNo})` : ""}</option>)}
          </select></div>
      </div>
      <div className="mt-8"><label>비고</label><input value={form.note} maxLength={100} placeholder="예: 호가 3회 후 낙찰" disabled={!canWrite || busy} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
      {canWrite && <button className="btn-primary mt-16" type="button" onClick={submit} disabled={busy || !(Number(form.price) > 0) || !form.winnerMembershipId}>{busy ? <span className="spinner" /> : "현장 결과 확정 · 개찰"}</button>}
    </div>
  );
}
