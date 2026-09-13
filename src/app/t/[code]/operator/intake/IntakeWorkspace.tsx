"use client";
import { useMemo, useRef, useState } from "react";
import type { AuctionStatus, BidUnit, Grade, IntakeStatus } from "@/db/schema";
import { Badge, StatusBadge } from "@/components/Badge";
import { ConfirmModal, Modal } from "@/components/Modal";
import { AUCTION_STATUS, INTAKE_STATUS } from "@/domain/status";
import { num, unitLabel } from "@/lib/format";
import { useAction } from "../_components/useAction";
import {
  addLotAction, confirmIntakeAction, createIntakeAction, createVesselAction, deleteDraftIntakeAction, removeLotAction,
  updateIntakeHeaderAction, updateLotAction, uploadPhotosAction, type LotFormInput,
} from "./actions";

export interface LotRow {
  id: string; auctionNo: string | null; tankNo: string | null; speciesCode: string; weightKg: number; unit: BidUnit; quantity: number;
  grade: Grade; note: string | null; photos: string[]; status: AuctionStatus; bidCount: number;
}
export interface SelectedIntake {
  id: string; vesselId: string; arrivedAt: string; roundId: string | null; status: IntakeStatus; note: string | null;
  vesselName: string; shipperName: string | null; roundLabel: string | null; roundStatus: string | null; items: LotRow[];
}
interface Props {
  code: string; readOnly: boolean; canCorrect: boolean; selected: SelectedIntake | null;
  vessels: { id: string; name: string; shipperName: string | null; shipperUserId: string | null }[];
  shippers: { userId: string; name: string }[];
  species: { code: string; name: string; defaultUnit: BidUnit }[];
  rounds: { id: string; label: string; status: string }[];
  defaultRoundId: string | null; nowLocal: string;
}
interface LotForm { tankNo: string; speciesCode: string; weightKg: string; unit: BidUnit; quantity: string; grade: Grade; note: string; photos: string[] }

const emptyLot = (speciesCode: string, unit: BidUnit): LotForm => ({ tankNo: "", speciesCode, weightKg: "", unit, quantity: "", grade: "A", note: "", photos: [] });
const toInput = (f: LotForm): LotFormInput => ({
  tankNo: f.tankNo || null, speciesCode: f.speciesCode, weightKg: Number(f.weightKg), unit: f.unit,
  quantity: f.unit === "kg" || !f.quantity ? null : Number(f.quantity), grade: f.grade, note: f.note || null, photos: f.photos,
});

export function IntakeWorkspace({ code, readOnly, canCorrect, selected, vessels, shippers, species, rounds, defaultRoundId, nowLocal }: Props) {
  const { busy, call, toast, router } = useAction();
  const isNew = !selected;
  const isDraft = !selected || selected.status === "draft";
  const editable = !readOnly && (isDraft || canCorrect);
  const firstSpecies = species[0];

  // ── 선박 정보
  const [header, setHeader] = useState({ vesselId: selected?.vesselId ?? "", arrivedAt: selected?.arrivedAt ?? nowLocal, roundId: selected?.roundId ?? defaultRoundId ?? "", note: selected?.note ?? "" });
  const [newVessel, setNewVessel] = useState<{ open: boolean; name: string; shipperUserId: string; registrationNo: string }>({ open: false, name: "", shipperUserId: shippers[0]?.userId ?? "", registrationNo: "" });
  const vessel = vessels.find((v) => v.id === header.vesselId);

  // ── 품목 폼
  const [lot, setLot] = useState<LotForm>(() => emptyLot(firstSpecies?.code ?? "", firstSpecies?.defaultUnit ?? "kg"));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 모달
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [correct, setCorrect] = useState<{ row: LotRow; form: LotForm; reason: string } | null>(null);
  const [withdraw, setWithdraw] = useState<{ row: LotRow; reason: string } | null>(null);

  const speciesName = useMemo(() => Object.fromEntries(species.map((s) => [s.code, s.name])), [species]);
  const totalWeight = selected?.items.reduce((s, i) => s + i.weightKg, 0) ?? 0;

  const pickSpecies = (codeSel: string, set: (f: (prev: LotForm) => LotForm) => void) => {
    const s = species.find((x) => x.code === codeSel);
    set((p) => ({ ...p, speciesCode: codeSel, unit: s?.defaultUnit ?? p.unit }));
  };

  const saveHeader = async () => {
    if (isNew) {
      const r = await call(createIntakeAction(code, header, []), { refresh: false });
      if (r.ok) router.push(`?intake=${r.data}`);
    } else if (selected) {
      await call(updateIntakeHeaderAction(code, selected.id, header));
    }
  };

  const registerVessel = async () => {
    const r = await call(createVesselAction(code, { name: newVessel.name, shipperUserId: newVessel.shipperUserId, registrationNo: newVessel.registrationNo || null }));
    if (r.ok) { setHeader((h) => ({ ...h, vesselId: r.data.id })); setNewVessel((n) => ({ ...n, open: false, name: "", registrationNo: "" })); }
  };

  const addLot = async () => {
    if (!lot.speciesCode) return toast("어종을 선택하세요");
    if (!(Number(lot.weightKg) > 0)) return toast("중량은 0보다 커야 합니다");
    if (isNew) {
      if (!header.vesselId) return toast("선박을 선택하세요");
      const r = await call(createIntakeAction(code, header, [toInput(lot)]), { refresh: false });
      if (r.ok) router.push(`?intake=${r.data}`);
      return;
    }
    if (!selected) return;
    const r = await call(addLotAction(code, selected.id, toInput(lot)));
    if (r.ok) setLot(emptyLot(lot.speciesCode, lot.unit));
  };

  const onFiles = async (files: FileList | null, target: "new" | "correct") => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("photos", f));
    setUploading(true);
    try {
      const r = await call(uploadPhotosAction(code, fd), { refresh: false });
      if (r.ok) {
        if (target === "new") setLot((p) => ({ ...p, photos: [...p.photos, ...r.data] }));
        else setCorrect((c) => (c ? { ...c, form: { ...c.form, photos: [...c.form.photos, ...r.data] } } : c));
      }
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeRow = async (row: LotRow) => {
    if (isDraft) { await call(removeLotAction(code, row.id)); return; }
    setWithdraw({ row, reason: "" });
  };

  const submitCorrect = async () => {
    if (!correct) return;
    const full = toInput(correct.form);
    // 입찰이 있는 물품은 어종·단위·중량 변경 불가 → 해당 필드 제외
    const patch = correct.row.bidCount > 0 ? { tankNo: full.tankNo, grade: full.grade, note: full.note, photos: full.photos, quantity: full.quantity } : full;
    const r = await call(updateLotAction(code, correct.row.id, patch, isDraft ? undefined : correct.reason));
    if (r.ok) setCorrect(null);
  };
  const submitWithdraw = async () => {
    if (!withdraw) return;
    const r = await call(removeLotAction(code, withdraw.row.id, withdraw.reason));
    if (r.ok) setWithdraw(null);
  };
  const submitConfirm = async () => {
    if (!selected) return;
    const r = await call(confirmIntakeAction(code, selected.id, header.roundId || null), { refresh: false });
    if (r.ok) { setConfirmOpen(false); router.push(`?intake=${selected.id}`); router.refresh(); }
  };
  const submitDelete = async () => {
    if (!selected) return;
    const r = await call(deleteDraftIntakeAction(code, selected.id), { refresh: false });
    if (r.ok) { setDeleteOpen(false); router.push("?intake=new"); }
  };

  const lotFields = (f: LotForm, set: (fn: (p: LotForm) => LotForm) => void, disabled: boolean, lockCore: boolean) => (
    <div className="form-grid">
      <div><label>물탱크 번호</label><input value={f.tankNo} placeholder="예: T-04" disabled={disabled} onChange={(e) => set((p) => ({ ...p, tankNo: e.target.value }))} /></div>
      <div><label>어종 *</label>
        <select value={f.speciesCode} disabled={disabled || lockCore} onChange={(e) => pickSpecies(e.target.value, set)}>
          {species.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
      </div>
      <div><label>중량 (kg) *</label><input type="number" min={0} step="0.1" inputMode="decimal" value={f.weightKg} placeholder="예: 230" disabled={disabled || lockCore} onChange={(e) => set((p) => ({ ...p, weightKg: e.target.value }))} /></div>
      <div><label>입찰 단위 *</label>
        <select value={f.unit} disabled={disabled || lockCore} onChange={(e) => set((p) => ({ ...p, unit: e.target.value as BidUnit }))}>
          <option value="kg">kg (킬로그램)</option><option value="box">박스</option><option value="ea">마리</option>
        </select>
      </div>
      {f.unit !== "kg" && (
        <div><label>{f.unit === "box" ? "박스 수" : "마리 수"} <span className="muted">(비우면 환산표로 계산)</span></label>
          <input type="number" min={0} step="1" inputMode="numeric" value={f.quantity} disabled={disabled} onChange={(e) => set((p) => ({ ...p, quantity: e.target.value }))} /></div>
      )}
      <div><label>등급 *</label>
        <select value={f.grade} disabled={disabled} onChange={(e) => set((p) => ({ ...p, grade: e.target.value as Grade }))}><option>A</option><option>B</option><option>C</option></select>
      </div>
      <div><label>참고사항 <span className="muted">(100자)</span></label><input value={f.note} maxLength={100} placeholder="예: 활어, 선도 우수" disabled={disabled} onChange={(e) => set((p) => ({ ...p, note: e.target.value }))} /></div>
    </div>
  );

  const photoGrid = (photos: string[], onRemove?: (i: number) => void) => photos.length > 0 && (
    <div className="photo-grid mt-8">
      {photos.map((p, i) => (
        <div key={p + i} className="photo-thumb">
          <img src={p} alt={`사진 ${i + 1}`} />
          {onRemove && <button type="button" onClick={() => onRemove(i)} aria-label="사진 삭제">✕</button>}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {/* ── 1. 선박 정보 */}
      <div className="panel">
        <div className="panel-header">
          <h2>선박 정보 {selected && <StatusBadge map={INTAKE_STATUS} value={selected.status} />}</h2>
          {!readOnly && isDraft && (
            <div>
              {selected && <button className="btn-ghost btn-sm" type="button" onClick={() => setDeleteOpen(true)} disabled={busy}>입고 삭제</button>}
              <button className="btn-secondary btn-sm" type="button" onClick={saveHeader} disabled={busy || !header.vesselId}>{isNew ? "입고 생성 (품목 없이)" : "선박 정보 저장"}</button>
            </div>
          )}
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div><label>선박 *</label>
              <select value={header.vesselId} disabled={readOnly || !isDraft} onChange={(e) => setHeader((h) => ({ ...h, vesselId: e.target.value }))}>
                <option value="">선박 선택</option>
                {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}{v.shipperName ? ` (${v.shipperName})` : ""}</option>)}
              </select>
              {!readOnly && isDraft && !newVessel.open && <button type="button" className="btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setNewVessel((n) => ({ ...n, open: true }))}>+ 신규 선박</button>}
            </div>
            <div><label>선주</label><input value={selected && !isDraft ? selected.shipperName ?? "-" : vessel?.shipperName ?? ""} readOnly placeholder="선박 선택 시 자동" /></div>
            <div><label>도착 시각 *</label><input type="datetime-local" value={header.arrivedAt} disabled={readOnly || !isDraft} onChange={(e) => setHeader((h) => ({ ...h, arrivedAt: e.target.value }))} /></div>
            <div><label>경매 회차 *</label>
              {isDraft ? (
                <select value={header.roundId} disabled={readOnly} onChange={(e) => setHeader((h) => ({ ...h, roundId: e.target.value }))}>
                  <option value="">회차 선택</option>
                  {rounds.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              ) : <input value={selected?.roundLabel ?? "-"} readOnly />}
            </div>
            <div><label>메모</label><input value={header.note} maxLength={200} disabled={readOnly || !isDraft} onChange={(e) => setHeader((h) => ({ ...h, note: e.target.value }))} placeholder="선박 메모 (선택)" /></div>
          </div>
          {newVessel.open && (
            <div className="inline-new">
              <div className="form-grid">
                <div><label>선박명 *</label><input value={newVessel.name} onChange={(e) => setNewVessel((n) => ({ ...n, name: e.target.value }))} placeholder="예: 동해호" /></div>
                <div><label>선주 *</label>
                  <select value={newVessel.shipperUserId} onChange={(e) => setNewVessel((n) => ({ ...n, shipperUserId: e.target.value }))}>
                    {shippers.length === 0 && <option value="">등록된 선주 없음</option>}
                    {shippers.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
                  </select>
                </div>
                <div><label>선박 등록번호</label><input value={newVessel.registrationNo} onChange={(e) => setNewVessel((n) => ({ ...n, registrationNo: e.target.value }))} placeholder="선택" /></div>
              </div>
              <div className="flex mt-8" style={{ justifyContent: "flex-end" }}>
                <button className="btn-secondary btn-sm" type="button" onClick={() => setNewVessel((n) => ({ ...n, open: false }))}>취소</button>
                <button className="btn-primary btn-sm" type="button" onClick={registerVessel} disabled={busy || !newVessel.name || !newVessel.shipperUserId}>선박 등록</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. 입고 품목 추가 */}
      {editable && (
        <div className="panel">
          <div className="panel-header"><h2>입고 품목 추가{!isDraft && <span className="muted small"> · 확정 후 추가 = 정정 (감사 기록)</span>}</h2></div>
          <div className="panel-body">
            {lotFields(lot, setLot, busy, false)}
            <div className="form-row mt-16" style={{ alignItems: "center", marginBottom: 0 }}>
              <label style={{ margin: 0 }}>사진 첨부 (상태 증빙, 각 5MB 이하)</label>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" style={{ width: "auto" }} disabled={uploading || busy} onChange={(e) => onFiles(e.target.files, "new")} />
              {uploading && <span className="spinner" />}
            </div>
            {photoGrid(lot.photos, (i) => setLot((p) => ({ ...p, photos: p.photos.filter((_, j) => j !== i) })))}
            <div className="form-actions">
              <button className="btn-secondary" type="button" onClick={() => setLot(emptyLot(lot.speciesCode, lot.unit))} disabled={busy}>초기화</button>
              <button className="btn-primary" type="button" onClick={addLot} disabled={busy || uploading}>{busy ? <span className="spinner" /> : "+ 품목 추가"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. 입고 리스트 */}
      <div className="panel">
        <div className="panel-header">
          <h2>입고 리스트{selected ? ` (${selected.vesselName})` : ""} <span className="muted small">{selected ? `${selected.items.length}품목 · ${num(totalWeight)}kg` : ""}</span></h2>
          {!readOnly && isDraft && selected && (
            <button className="btn-primary" type="button" onClick={() => setConfirmOpen(true)} disabled={busy || selected.items.length === 0}>전체 입고 확정</button>
          )}
        </div>
        <div className="panel-body dense">
          {!selected || selected.items.length === 0 ? (
            <div className="empty-state" style={{ padding: "30px 16px" }}><div className="emoji">🐟</div>{selected ? "품목을 추가하세요" : "선박 정보를 입력하고 첫 품목을 추가하면 입고가 생성됩니다"}</div>
          ) : (
            <table className="data-table">
              <thead><tr>
                {!isDraft && <th>경매번호</th>}<th>탱크</th><th>어종</th><th className="num">중량(kg)</th><th>단위</th><th className="num">수량</th><th>등급</th><th>참고</th><th className="num">사진</th>{!isDraft && <th>상태</th>}{editable && <th></th>}
              </tr></thead>
              <tbody>
                {selected.items.map((r) => (
                  <tr key={r.id}>
                    {!isDraft && <td className="mono small">{r.auctionNo ?? "-"}</td>}
                    <td>{r.tankNo ?? "-"}</td>
                    <td>{speciesName[r.speciesCode] ?? r.speciesCode}</td>
                    <td className="num">{num(r.weightKg, 1)}</td>
                    <td><Badge tone="info">{unitLabel(r.unit)}</Badge></td>
                    <td className="num">{r.unit === "kg" ? "-" : `${num(r.quantity)}${unitLabel(r.unit)}`}</td>
                    <td>{r.grade}</td>
                    <td className="muted">{r.note ?? "-"}</td>
                    <td className="num">{r.photos.length ? `${r.photos.length}장` : "-"}</td>
                    {!isDraft && <td><StatusBadge map={AUCTION_STATUS} value={r.status} />{r.bidCount > 0 && <span className="muted small"> 입찰 {r.bidCount}</span>}</td>}
                    {editable && (
                      <td className="actions">
                        <button className="btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setCorrect({ row: r, reason: "", form: { tankNo: r.tankNo ?? "", speciesCode: r.speciesCode, weightKg: String(r.weightKg), unit: r.unit, quantity: r.unit === "kg" ? "" : String(r.quantity), grade: r.grade, note: r.note ?? "", photos: r.photos } })}>{isDraft ? "수정" : "정정"}</button>
                        <button className="btn-ghost btn-sm text-danger" type="button" disabled={busy || r.bidCount > 0} onClick={() => removeRow(r)}>{isDraft ? "삭제" : "취소"}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {confirmOpen && selected && (
        <ConfirmModal title="전체 입고 확정" confirmLabel="확정" busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={submitConfirm}
          message={<>{selected.vesselName} · {selected.items.length}품목 · {num(totalWeight)}kg 을(를) <strong>{rounds.find((r) => r.id === header.roundId)?.label ?? selected.roundLabel ?? "선택한 회차"}</strong>에 확정합니다.<br /><span className="muted small">확정 후 경매번호가 부여되며, 이후 수정은 운영자 정정(감사 기록)으로만 가능합니다.</span></>}>
          {header.roundId !== (selected.roundId ?? "") && <p className="small text-danger" style={{ marginBottom: 0 }}>선박 정보의 회차 변경이 함께 적용됩니다.</p>}
        </ConfirmModal>
      )}
      {deleteOpen && selected && (
        <ConfirmModal title="입고 삭제" confirmLabel="삭제" danger busy={busy} onClose={() => setDeleteOpen(false)} onConfirm={submitDelete}
          message={`${selected.vesselName} 입고(품목 ${selected.items.length}건)를 삭제합니다. 미확정 입고만 삭제할 수 있습니다.`} />
      )}
      {correct && (
        <Modal title={isDraft ? "품목 수정" : `품목 정정 · ${correct.row.auctionNo ?? ""}`} onClose={() => setCorrect(null)} footer={<>
          <button className="btn-secondary" type="button" onClick={() => setCorrect(null)} disabled={busy}>취소</button>
          <button className="btn-primary" type="button" onClick={submitCorrect} disabled={busy || (!isDraft && correct.reason.trim().length < 2)}>{busy ? <span className="spinner" /> : isDraft ? "저장" : "정정 저장"}</button>
        </>}>
          {correct.row.bidCount > 0 && <div className="notice-box">⚠️ 입찰이 있는 물품은 어종·단위·중량을 변경할 수 없습니다.</div>}
          {lotFields(correct.form, (fn) => setCorrect((c) => (c ? { ...c, form: fn(c.form) } : c)), busy, correct.row.bidCount > 0)}
          <div className="mt-8">
            <label>사진</label>
            <input type="file" accept="image/*" multiple style={{ width: "auto" }} disabled={uploading || busy} onChange={(e) => onFiles(e.target.files, "correct")} />
            {photoGrid(correct.form.photos, (i) => setCorrect((c) => (c ? { ...c, form: { ...c.form, photos: c.form.photos.filter((_, j) => j !== i) } } : c)))}
          </div>
          {!isDraft && <div className="mt-8"><label>정정 사유 * <span className="muted">(감사 로그에 기록)</span></label><input value={correct.reason} onChange={(e) => setCorrect((c) => (c ? { ...c, reason: e.target.value } : c))} placeholder="예: 검수 결과 중량 오기" /></div>}
        </Modal>
      )}
      {withdraw && (
        <Modal title={`품목 취소 · ${withdraw.row.auctionNo ?? ""}`} onClose={() => setWithdraw(null)} footer={<>
          <button className="btn-secondary" type="button" onClick={() => setWithdraw(null)} disabled={busy}>닫기</button>
          <button className="btn-danger" type="button" onClick={submitWithdraw} disabled={busy || withdraw.reason.trim().length < 2}>{busy ? <span className="spinner" /> : "취소 처리"}</button>
        </>}>
          <p style={{ marginTop: 0 }}>확정된 입고의 품목을 취소(withdrawn)합니다. 사유가 감사 로그에 기록됩니다.</p>
          <label>취소 사유 *</label><input value={withdraw.reason} onChange={(e) => setWithdraw((w) => (w ? { ...w, reason: e.target.value } : w))} placeholder="예: 선주 요청으로 출하 취소" />
        </Modal>
      )}
    </div>
  );
}
