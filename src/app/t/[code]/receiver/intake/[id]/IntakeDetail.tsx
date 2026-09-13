"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AuctionStatus, BidUnit, Grade } from "@/db/schema";
import { Modal, ConfirmModal } from "@/components/Modal";
import { StatusBadge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import { AUCTION_STATUS, GRADE_LABEL } from "@/domain/status";
import { UNIT_LABEL, num, won } from "@/lib/format";
import { dataUrlToBlob } from "@/lib/client-image";
import { LotEditor, emptyLot, newLocalId, validateLotDraft, type LotDraft, type SpeciesOpt } from "../../LotEditor";
import { addLotAction, updateLotAction, removeLotAction, confirmIntakeAction, deleteDraftIntakeAction, uploadPhotoAction } from "../../actions";

export interface LotItem { id: string; auctionNo: string | null; tankNo: string | null; speciesCode: string; weightKg: number; unit: BidUnit; quantity: number; grade: Grade; note: string | null; photos: string[]; status: AuctionStatus; bidCount: number; reservePrice: number | null }

export function IntakeDetail({ code, intakeId, roundId, canWrite, canConfirm, species, rounds, items }: {
  code: string; intakeId: string; roundId: string | null; canWrite: boolean; canConfirm: boolean; species: SpeciesOpt[]; rounds: { id: string; label: string }[]; items: LotItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null; draft: LotDraft } | null>(null);
  const [removing, setRemoving] = useState<LotItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmRound, setConfirmRound] = useState(roundId ?? rounds[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const spName = (c: string) => species.find((s) => s.code === c)?.name ?? c;

  const toDraft = (a: LotItem): LotDraft => ({ localId: newLocalId(), speciesCode: a.speciesCode, weightKg: String(a.weightKg), unit: a.unit, quantity: a.unit === "kg" ? "" : String(a.quantity), grade: a.grade, note: a.note ?? "", tankNo: a.tankNo ?? "", photos: a.photos.map((url) => ({ url })) });

  const uploadPhotos = async (d: LotDraft): Promise<string[]> => {
    const urls: string[] = [];
    for (const p of d.photos) {
      if (p.url) { urls.push(p.url); continue; }
      if (!p.dataUrl) continue;
      const fd = new FormData(); const blob = dataUrlToBlob(p.dataUrl);
      fd.append("file", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
      const r = await uploadPhotoAction(code, fd);
      if (!r.ok || !r.data) throw new Error(r.ok ? "사진 업로드 실패" : r.error);
      urls.push(r.data.url);
    }
    return urls;
  };

  const saveLot = () => {
    if (!editing) return;
    const e = validateLotDraft(editing.draft);
    if (e) { setError(e); return; }
    setError(null);
    start(async () => {
      try {
        const d = editing.draft;
        const photos = await uploadPhotos(d);
        const lot = { tankNo: d.tankNo.trim() || null, speciesCode: d.speciesCode, weightKg: Number(d.weightKg), unit: d.unit, quantity: d.unit !== "kg" && d.quantity ? Number(d.quantity) : null, grade: d.grade, note: d.note.trim() || null, photos };
        const r = editing.id ? await updateLotAction(code, intakeId, editing.id, lot) : await addLotAction(code, intakeId, lot);
        if (!r.ok) { setError(r.error); return; }
        toast(r.message ?? "저장됨"); setEditing(null); router.refresh();
      } catch (err) { setError(err instanceof Error ? err.message : "네트워크 오류"); }
    });
  };

  const doRemove = () => {
    if (!removing) return;
    start(async () => {
      const r = await removeLotAction(code, intakeId, removing.id);
      if (!r.ok) { toast(r.error); return; }
      toast(r.message ?? "삭제됨"); setRemoving(null); router.refresh();
    });
  };

  const doConfirm = () => {
    if (!confirmRound) { setError("회차를 선택하세요"); return; }
    start(async () => {
      const r = await confirmIntakeAction(code, intakeId, confirmRound);
      if (!r.ok) { setError(r.error); toast(r.error); return; }
      toast(`✅ 확정 완료 · ${r.data?.roundLabel ?? ""} ${r.data?.lots ?? 0}개 품목`); setConfirming(false); router.refresh();
    });
  };

  const doDelete = () => {
    start(async () => {
      const r = await deleteDraftIntakeAction(code, intakeId);
      if (!r.ok) { toast(r.error); return; }
      toast(r.message ?? "삭제됨"); router.push(`/t/${code}/receiver`);
    });
  };

  return (
    <>
      <div className="section-title">품목 ({items.length}개)</div>
      {items.length === 0 && <div className="readonly-note">품목이 없습니다. {canWrite && "품목을 추가한 후 확정하세요."}</div>}
      {items.map((a) => (
        <div key={a.id} className="lot-card">
          <div className="row">
            <div>
              <div className="title">{spName(a.speciesCode)} · {GRADE_LABEL[a.grade] ?? a.grade} {a.auctionNo && <span className="small muted">· {a.auctionNo.split("-").pop()}</span>}</div>
              <div className="sub">{num(a.weightKg)}kg{a.unit !== "kg" && ` · ${num(a.quantity)}${UNIT_LABEL[a.unit]}`} · 단위 {UNIT_LABEL[a.unit]}{a.tankNo && ` · 수조 ${a.tankNo}`}{a.reservePrice != null && ` · 최저가 ${won(a.reservePrice)}`}</div>
              {a.note && <div className="sub">{a.note}</div>}
            </div>
            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
              <StatusBadge map={AUCTION_STATUS} value={a.status} />
              {canWrite && (
                <div className="actions">
                  <button type="button" className="btn-secondary" onClick={() => { setError(null); setEditing({ id: a.id, draft: toDraft(a) }); }} disabled={pending}>수정</button>
                  <button type="button" className="btn-ghost" onClick={() => setRemoving(a)} disabled={pending || a.bidCount > 0}>삭제</button>
                </div>
              )}
            </div>
          </div>
          {a.photos.length > 0 && (
            <div className="photo-grid">{a.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`${spName(a.speciesCode)} 사진`} /></a>)}</div>
          )}
        </div>
      ))}

      {canWrite && (
        <>
          <button type="button" className="btn-secondary" style={{ width: "100%" }} onClick={() => { setError(null); setEditing({ id: null, draft: emptyLot(species) }); }} disabled={pending}>+ 품목 추가</button>
          <div className="sticky-actions mt-16">
            <button type="button" className="btn-danger" onClick={() => setDeleting(true)} disabled={pending}>🗑 입고 삭제</button>
            {canConfirm && <button type="button" className="btn-primary" onClick={() => { setError(null); setConfirming(true); }} disabled={pending || items.length === 0}>✅ 확정</button>}
          </div>
        </>
      )}

      {editing && (
        <Modal title={editing.id ? "품목 수정" : "품목 추가"} onClose={() => !pending && setEditing(null)} footer={<>
          <button type="button" className="btn-secondary" onClick={() => setEditing(null)} disabled={pending}>취소</button>
          <button type="button" className="btn-primary" onClick={saveLot} disabled={pending}>{pending ? <span className="spinner" /> : "저장"}</button>
        </>}>
          <LotEditor value={editing.draft} onChange={(d) => setEditing({ ...editing, draft: d })} species={species} disabled={pending} compact />
          {editing.id && items.find((x) => x.id === editing.id)?.bidCount ? <div className="small muted mt-8">입찰이 있는 물품은 어종·단위·중량을 변경할 수 없습니다</div> : null}
          {error && <div className="text-danger small mt-8">{error}</div>}
        </Modal>
      )}
      {removing && <ConfirmModal title="품목 삭제" danger confirmLabel="삭제" busy={pending} onClose={() => setRemoving(null)} onConfirm={doRemove} message={<>{spName(removing.speciesCode)} {num(removing.weightKg)}kg 품목을 삭제할까요?</>} />}
      {confirming && (
        <ConfirmModal title="입고 확정" confirmLabel="확정" busy={pending} onClose={() => !pending && setConfirming(false)} onConfirm={doConfirm}
          message={<>품목 {items.length}개를 확정하고 경매 회차에 묶습니다. 확정 후 수정은 운영자 정정이 필요합니다.</>}>
          <label>경매 회차 *</label>
          <select value={confirmRound} onChange={(e) => setConfirmRound(e.target.value)} disabled={pending}>
            <option value="">선택</option>
            {rounds.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          {rounds.length === 0 && <div className="text-danger small mt-8">진행 가능한 회차가 없습니다. 운영자에게 회차 생성을 요청하세요.</div>}
          {error && <div className="text-danger small mt-8">{error}</div>}
        </ConfirmModal>
      )}
      {deleting && <ConfirmModal title="입고 삭제" danger confirmLabel="삭제" busy={pending} onClose={() => setDeleting(false)} onConfirm={doDelete} message="이 입고와 모든 품목을 삭제합니다. 되돌릴 수 없습니다." />}
    </>
  );
}
