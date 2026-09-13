"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { ConfirmModal } from "@/components/Modal";
import { UNIT_LABEL, num } from "@/lib/format";
import { enqueue, newClientRef, syncOne, type QueuedIntake } from "@/lib/offline-queue";
import { LotEditor, emptyLot, validateLotDraft, toQueuedLot, type LotDraft, type SpeciesOpt } from "../LotEditor";
import { createVesselAction } from "../actions";
import { makeHandlers } from "../handlers";

interface VesselOpt { id: string; name: string; shipperName: string | null; registrationNo: string | null }
interface RoundOpt { id: string; label: string; bidCloseAt: string }

/** datetime-local(KST) → ISO */
const localToIso = (v: string) => new Date(`${v}:00+09:00`).toISOString();

export function IntakeForm({ code, vessels: initialVessels, shippers, species, rounds, defaultRoundId, defaultArrivedAt }: {
  code: string; vessels: VesselOpt[]; shippers: { userId: string; name: string }[]; species: SpeciesOpt[]; rounds: RoundOpt[]; defaultRoundId: string | null; defaultArrivedAt: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [vessels, setVessels] = useState(initialVessels);
  const [vesselId, setVesselId] = useState(initialVessels[0]?.id ?? "");
  const [vesselQuery, setVesselQuery] = useState("");
  const [showNew, setShowNew] = useState(initialVessels.length === 0);
  const [newVessel, setNewVessel] = useState({ name: "", shipperUserId: shippers[0]?.userId ?? "", registrationNo: "" });
  const [arrivedAt, setArrivedAt] = useState(defaultArrivedAt);
  const [roundId, setRoundId] = useState<string>(defaultRoundId ?? "");
  const [note, setNote] = useState("");
  const [lots, setLots] = useState<LotDraft[]>([emptyLot(species)]);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const filteredVessels = useMemo(() => {
    const q = vesselQuery.trim().toLowerCase();
    return q ? vessels.filter((v) => v.name.toLowerCase().includes(q) || (v.shipperName ?? "").toLowerCase().includes(q)) : vessels;
  }, [vessels, vesselQuery]);
  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const totalWeight = lots.reduce((s, l) => s + (Number(l.weightKg) || 0), 0);

  const updateLot = (i: number, v: LotDraft) => { setDirty(true); setLots((ls) => ls.map((l, j) => (j === i ? v : l))); };
  const addLot = () => setLots((ls) => [...ls, { ...emptyLot(species), speciesCode: ls[ls.length - 1]?.speciesCode ?? species[0]?.code ?? "", unit: ls[ls.length - 1]?.unit ?? "kg" }]);
  const removeLot = (i: number) => setLots((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const addVessel = () => {
    if (newVessel.name.trim().length < 2 || newVessel.name.trim().length > 30) { setError("선박명은 2~30자"); return; }
    if (!newVessel.shipperUserId) { setError("선주를 선택하세요"); return; }
    setError(null);
    start(async () => {
      try {
        const r = await createVesselAction(code, { name: newVessel.name.trim(), registrationNo: newVessel.registrationNo.trim() || null, shipperUserId: newVessel.shipperUserId });
        if (!r.ok || !r.data) { setError(r.ok ? "선박 등록 실패" : r.error); return; }
        const sh = shippers.find((s) => s.userId === newVessel.shipperUserId);
        setVessels((vs) => [...vs, { id: r.data!.id, name: r.data!.name, shipperName: sh?.name ?? null, registrationNo: newVessel.registrationNo || null }].sort((a, b) => a.name.localeCompare(b.name, "ko")));
        setVesselId(r.data.id); setShowNew(false); setNewVessel({ name: "", shipperUserId: shippers[0]?.userId ?? "", registrationNo: "" });
        toast(r.message ?? "선박을 등록했습니다");
      } catch { setError("네트워크 오류 — 신규 선박 등록은 온라인에서만 가능합니다"); }
    });
  };

  const validate = (): string | null => {
    if (!vesselId) return "선박을 선택하세요";
    if (!arrivedAt) return "도착 시각을 입력하세요";
    if (lots.length === 0) return "품목을 1개 이상 입력하세요";
    for (let i = 0; i < lots.length; i++) { const e = validateLotDraft(lots[i]); if (e) return `${i + 1}번 품목: ${e}`; }
    return null;
  };

  const build = (confirm: boolean): QueuedIntake => ({
    clientRef: newClientRef(), tenantCode: code, vesselId, vesselName: vessel?.name ?? "", arrivedAt: localToIso(arrivedAt), roundId: roundId || null,
    roundLabel: rounds.find((r) => r.id === roundId)?.label ?? null, note: note.trim() || null, confirm, items: lots.map((l) => toQueuedLot(l, species)), queuedAt: new Date().toISOString(),
  });

  const save = (confirm: boolean) => {
    const e = validate();
    if (e) { setError(e); toast(e); setConfirmOpen(false); return; }
    setError(null);
    const item = build(confirm);
    start(async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue(item);
        toast("📵 오프라인 — 대기열에 저장됨");
        router.push(`/t/${code}/receiver/offline-queue`);
        return;
      }
      const out = await syncOne(item, makeHandlers(code));
      if (out.ok) {
        setConfirmOpen(false);
        if (out.confirmError) toast(`저장됨 · 확정 실패: ${out.confirmError}`);
        else toast(out.confirmed ? "✅ 입고 저장 후 확정 완료" : "💾 임시 저장됨");
        router.push(`/t/${code}/receiver/intake/${out.intakeId}`);
        return;
      }
      if (out.network) {
        await enqueue({ ...item, lastError: out.error });
        toast("📵 오프라인 — 대기열에 저장됨");
        router.push(`/t/${code}/receiver/offline-queue`);
        return;
      }
      setConfirmOpen(false);
      setError(out.error); toast(out.error);
    });
  };

  return (
    <form data-dirty={dirty ? "true" : undefined} onSubmit={(e) => e.preventDefault()} onChange={() => setDirty(true)}>
      {/* 1. 선박 */}
      <div className="detail-section">
        <h2>1️⃣ 선박 선택</h2>
        {vessels.length > 6 && <input type="search" placeholder="선박명·선주 검색" value={vesselQuery} onChange={(e) => setVesselQuery(e.target.value)} className="mb-8" />}
        <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} disabled={showNew}>
          {vessels.length === 0 && <option value="">등록된 선박 없음</option>}
          {filteredVessels.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.shipperName ?? "선주 미지정"}{v.registrationNo ? ` (${v.registrationNo})` : ""}</option>)}
        </select>
        {!showNew ? (
          <button type="button" className="btn-ghost small mt-8" onClick={() => setShowNew(true)}>+ 신규 선박 (마스터에 없을 때)</button>
        ) : (
          <div className="inline-new">
            <div><label>선박명 * (2~30자)</label><input type="text" maxLength={30} placeholder="제3만선호" value={newVessel.name} onChange={(e) => setNewVessel((v) => ({ ...v, name: e.target.value }))} /></div>
            <div><label>선주 *</label>
              <select value={newVessel.shipperUserId} onChange={(e) => setNewVessel((v) => ({ ...v, shipperUserId: e.target.value }))}>
                {shippers.length === 0 && <option value="">등록된 선주 없음 — 관리자에게 초청 요청</option>}
                {shippers.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
              </select>
            </div>
            <div><label>어선 번호</label><input type="text" maxLength={30} placeholder="KR-1234" value={newVessel.registrationNo} onChange={(e) => setNewVessel((v) => ({ ...v, registrationNo: e.target.value }))} /></div>
            <div className="flex">
              <button type="button" className="btn-primary" onClick={addVessel} disabled={pending || shippers.length === 0}>{pending ? <span className="spinner" /> : "선박 등록"}</button>
              {vessels.length > 0 && <button type="button" className="btn-secondary" onClick={() => setShowNew(false)} disabled={pending}>취소</button>}
            </div>
          </div>
        )}
        <div className="two mt-8" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><label>도착 시각 *</label><input type="datetime-local" value={arrivedAt} onChange={(e) => setArrivedAt(e.target.value)} /></div>
          <div><label>경매 회차</label>
            <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
              <option value="">확정 시 선택</option>
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-8"><label>입고 메모</label><input type="text" maxLength={200} placeholder="선택" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>

      {/* 2. 품목 */}
      <div className="section-title">2️⃣ 물품 ({lots.length}개 · {num(totalWeight)}kg)</div>
      {lots.map((l, i) => (
        <div key={l.localId} className="detail-section">
          <div className="flex space-between mb-8">
            <strong>품목 {i + 1}{l.speciesCode && <span className="muted small"> · {species.find((s) => s.code === l.speciesCode)?.name} · {UNIT_LABEL[l.unit]}</span>}</strong>
            {lots.length > 1 && <button type="button" className="btn-ghost small" onClick={() => removeLot(i)}>삭제</button>}
          </div>
          <LotEditor value={l} onChange={(v) => updateLot(i, v)} species={species} disabled={pending} />
        </div>
      ))}
      <button type="button" className="btn-secondary" style={{ width: "100%" }} onClick={addLot} disabled={pending}>+ 품목 추가</button>

      {error && <div className="form-error mt-16">{error}</div>}

      {/* 3. 저장 */}
      <div className="sticky-actions mt-16">
        <button type="button" className="btn-secondary" onClick={() => save(false)} disabled={pending}>{pending ? <span className="spinner" /> : "💾 임시 저장"}</button>
        <button type="button" className="btn-primary" onClick={() => { const e = validate(); if (e) { setError(e); toast(e); return; } setConfirmOpen(true); }} disabled={pending}>✅ 저장 후 확정</button>
      </div>
      <div className="small muted" style={{ textAlign: "center", marginTop: 6 }}>오프라인이면 기기에 저장되고 연결 복구 후 동기화됩니다</div>

      {confirmOpen && (
        <ConfirmModal title="입고 확정" confirmLabel="저장 후 확정" busy={pending} onClose={() => !pending && setConfirmOpen(false)} onConfirm={() => save(true)}
          message={<>{vessel?.name} · 품목 {lots.length}개 · {num(totalWeight)}kg 을 <strong>{rounds.find((r) => r.id === roundId)?.label ?? "(회차 미선택)"}</strong>에 확정합니다.</>}>
          <div className="small muted">확정 후에는 경매번호가 부여되며 수정은 운영자 정정으로만 가능합니다.{!roundId && <span className="text-danger"> 회차를 선택해야 확정할 수 있습니다.</span>}</div>
        </ConfirmModal>
      )}
    </form>
  );
}
