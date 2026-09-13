"use client";
import { useState } from "react";
import type { BidUnit, Grade } from "@/db/schema";
import { UNIT_LABEL } from "@/lib/format";
import { resizeImageToDataUrl } from "@/lib/client-image";
import type { QueuedLot, QueuedPhoto } from "@/lib/offline-queue";

export interface SpeciesOpt { code: string; name: string; defaultUnit: BidUnit }
export interface LotDraft {
  localId: string; speciesCode: string; weightKg: string; unit: BidUnit; quantity: string; grade: Grade; note: string; tankNo: string; photos: QueuedPhoto[];
}

export const newLocalId = () => Math.random().toString(36).slice(2, 10);
export function emptyLot(species: SpeciesOpt[]): LotDraft {
  const first = species[0];
  return { localId: newLocalId(), speciesCode: first?.code ?? "", weightKg: "", unit: first?.defaultUnit ?? "kg", quantity: "", grade: "A", note: "", tankNo: "", photos: [] };
}
export function validateLotDraft(l: LotDraft): string | null {
  if (!l.speciesCode) return "어종을 선택하세요";
  const w = Number(l.weightKg);
  if (!(w > 0)) return "중량은 0보다 커야 합니다";
  if (l.unit !== "kg" && l.quantity && !(Number(l.quantity) > 0)) return "수량은 0보다 커야 합니다";
  if (l.note.length > 100) return "참고사항은 100자 이내";
  if (l.photos.length > 10) return "사진은 10장 이내";
  return null;
}
export function toQueuedLot(l: LotDraft, species: SpeciesOpt[]): QueuedLot {
  return {
    tankNo: l.tankNo.trim() || null, speciesCode: l.speciesCode, speciesName: species.find((s) => s.code === l.speciesCode)?.name,
    weightKg: Number(l.weightKg), unit: l.unit, quantity: l.unit !== "kg" && l.quantity ? Number(l.quantity) : null, grade: l.grade, note: l.note.trim() || null, photos: l.photos,
  };
}

export function LotEditor({ value, onChange, species, disabled, compact }: { value: LotDraft; onChange: (v: LotDraft) => void; species: SpeciesOpt[]; disabled?: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof LotDraft>(k: K, v: LotDraft[K]) => onChange({ ...value, [k]: v });

  const onSpecies = (code: string) => {
    const sp = species.find((s) => s.code === code);
    onChange({ ...value, speciesCode: code, unit: sp?.defaultUnit ?? value.unit });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setErr(null);
    const added: QueuedPhoto[] = [];
    for (const f of Array.from(files)) {
      try {
        if (f.size > 20 * 1024 * 1024) { setErr("20MB 이하의 사진만 첨부할 수 있습니다"); continue; }
        added.push({ dataUrl: await resizeImageToDataUrl(f) });
      } catch (e) { setErr(e instanceof Error ? e.message : "사진 처리 실패"); }
    }
    onChange({ ...value, photos: [...value.photos, ...added].slice(0, 10) });
    setBusy(false);
  };

  return (
    <div className="lot-editor">
      <div className="two">
        <div>
          <label>어종 *</label>
          <select value={value.speciesCode} onChange={(e) => onSpecies(e.target.value)} disabled={disabled}>
            {species.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label>등급 *</label>
          <select value={value.grade} onChange={(e) => set("grade", e.target.value as Grade)} disabled={disabled}>
            <option value="A">A등급</option><option value="B">B등급</option><option value="C">C등급</option>
          </select>
        </div>
      </div>
      <div className="three">
        <div>
          <label>중량 (kg) *</label>
          <input type="number" inputMode="decimal" min={0} step="0.1" placeholder="0" value={value.weightKg} onChange={(e) => set("weightKg", e.target.value)} disabled={disabled} />
        </div>
        <div>
          <label>입찰 단위 *</label>
          <select value={value.unit} onChange={(e) => set("unit", e.target.value as BidUnit)} disabled={disabled}>
            {(["kg", "box", "ea"] as BidUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
          </select>
        </div>
        <div>
          <label>{value.unit === "kg" ? "수량" : `${UNIT_LABEL[value.unit]} 수`}</label>
          <input type="number" inputMode="numeric" min={0} step="1" placeholder={value.unit === "kg" ? "-" : "자동"} value={value.unit === "kg" ? "" : value.quantity} onChange={(e) => set("quantity", e.target.value)} disabled={disabled || value.unit === "kg"} />
        </div>
      </div>
      <div className={compact ? "two" : "two"}>
        <div>
          <label>수조/구역 번호</label>
          <input type="text" maxLength={20} placeholder="예: T-3" value={value.tankNo} onChange={(e) => set("tankNo", e.target.value)} disabled={disabled} />
        </div>
        <div>
          <label>참고 ({value.note.length}/100)</label>
          <input type="text" maxLength={100} placeholder="활어 · 선도 우수" value={value.note} onChange={(e) => set("note", e.target.value)} disabled={disabled} />
        </div>
      </div>
      <div>
        <label>사진 ({value.photos.length}/10) · 촬영 즉시 1920px 로 압축</label>
        <div className="photo-grid">
          {value.photos.map((p, i) => (
            <div key={i} className="photo-thumb">
              <img src={p.url ?? p.dataUrl} alt={`사진 ${i + 1}`} />
              {!disabled && <button type="button" onClick={() => set("photos", value.photos.filter((_, j) => j !== i))} aria-label="사진 삭제">✕</button>}
            </div>
          ))}
          {!disabled && value.photos.length < 10 && (
            <label className="photo-add" aria-label="사진 추가">
              {busy ? <span className="spinner" /> : "📷"}
              <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} disabled={busy} />
            </label>
          )}
        </div>
        {err && <div className="text-danger small mt-8">{err}</div>}
      </div>
    </div>
  );
}
