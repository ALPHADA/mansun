"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { fmtDateTime, num, UNIT_LABEL } from "@/lib/format";
import { listQueue, removeQueued, syncOne, QUEUE_EVENT, type QueuedIntake, type SyncOutcome } from "@/lib/offline-queue";
import { makeHandlers } from "../handlers";

export function OfflineQueueClient({ code, canWrite }: { code: string; canWrite: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState<QueuedIntake[] | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | "all" | null>(null);
  const [removing, setRemoving] = useState<QueuedIntake | null>(null);
  const [lastSynced, setLastSynced] = useState<{ intakeId: string; vesselName: string; confirmError?: string }[]>([]);

  const reload = useCallback(async () => { const q = await listQueue(code); setItems(q); setOnline(navigator.onLine); }, [code]);
  useEffect(() => {
    const id = setTimeout(() => { void reload(); }, 0);
    window.addEventListener(QUEUE_EVENT, reload); window.addEventListener("online", reload); window.addEventListener("offline", reload);
    return () => { clearTimeout(id); window.removeEventListener(QUEUE_EVENT, reload); window.removeEventListener("online", reload); window.removeEventListener("offline", reload); };
  }, [reload]);

  const handleOutcome = (item: QueuedIntake, out: SyncOutcome) => {
    if (out.ok) setLastSynced((l) => [{ intakeId: out.intakeId, vesselName: item.vesselName, confirmError: out.confirmError }, ...l]);
  };

  const syncItem = async (item: QueuedIntake) => {
    if (!navigator.onLine) { toast("📵 오프라인 상태입니다. 연결 후 다시 시도하세요"); return; }
    setBusy(item.clientRef);
    const out = await syncOne(item, makeHandlers(code));
    handleOutcome(item, out);
    toast(out.ok ? (out.duplicate ? "이미 서버에 저장된 입고입니다 (큐에서 제거)" : "✅ 동기화 완료") : `❌ ${out.error}`);
    setBusy(null); reload();
  };

  const syncAllNow = async () => {
    if (!navigator.onLine) { toast("📵 오프라인 상태입니다. 연결 후 다시 시도하세요"); return; }
    setBusy("all");
    const list = await listQueue(code);
    let ok = 0, fail = 0;
    for (const item of list) {
      const out = await syncOne(item, makeHandlers(code));
      handleOutcome(item, out);
      if (out.ok) ok++; else { fail++; if (out.network) break; }
    }
    toast(`동기화 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ""}`);
    setBusy(null); reload();
  };

  const doRemove = async () => {
    if (!removing) return;
    await removeQueued(removing.clientRef);
    setRemoving(null); toast("대기열에서 삭제했습니다"); reload();
  };

  if (items === null) return <div className="empty-state"><span className="spinner" /></div>;

  return (
    <>
      <div className={`live-banner stack`} style={!online ? { background: "#7f1d1d" } : undefined}>
        <div className="label">{online ? "📶 온라인" : "📵 오프라인"} · 동기화 대기 {items.length}건</div>
        <div className="sub">{online ? "동기화 시 사진 업로드 → 입고 저장(중복 방지 키 적용) 순으로 처리됩니다" : "네트워크 연결이 복구되면 동기화할 수 있습니다"}</div>
      </div>

      {canWrite && items.length > 0 && (
        <button type="button" className="btn-primary" style={{ width: "100%", padding: 12, marginBottom: 14 }} onClick={syncAllNow} disabled={busy !== null || !online}>{busy === "all" ? <span className="spinner" /> : "🔄 지금 동기화"}</button>
      )}

      {lastSynced.length > 0 && (
        <div className="detail-section" style={{ borderColor: "#a7f3d0", background: "#ecfdf5" }}>
          <div className="small" style={{ fontWeight: 600, color: "#065f46", marginBottom: 6 }}>방금 동기화됨</div>
          {lastSynced.map((s) => (
            <div key={s.intakeId} className="small" style={{ color: "#065f46" }}>
              <Link href={`/t/${code}/receiver/intake/${s.intakeId}`}>{s.vesselName} → 입고 상세 보기</Link>
              {s.confirmError && <span className="text-danger"> · 확정 실패: {s.confirmError} (임시 저장 상태)</span>}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && <div className="empty-state"><div className="emoji">✅</div>동기화 대기 중인 입고가 없습니다</div>}

      {items.map((q) => {
        const weight = q.items.reduce((s, l) => s + l.weightKg, 0);
        const photos = q.items.reduce((s, l) => s + l.photos.length, 0);
        return (
          <div key={q.clientRef} className={`queue-item${q.lastError ? " error" : ""}`}>
            <div className="flex space-between">
              <div>
                <div style={{ fontWeight: 600 }}>{q.vesselName || "선박 미지정"} {q.confirm && <span className="badge badge-info" style={{ fontSize: 10 }}>확정 요청</span>}</div>
                <div className="small muted">품목 {q.items.length}개 · {num(weight)}kg · 사진 {photos}장 · {q.roundLabel ?? "회차 미지정"}</div>
                <div className="small muted">저장 {fmtDateTime(q.queuedAt)} · 도착 {fmtDateTime(q.arrivedAt)}{q.lastTriedAt && ` · 마지막 시도 ${fmtDateTime(q.lastTriedAt)}`}</div>
              </div>
            </div>
            <div className="small mt-8" style={{ color: "var(--color-text-muted)" }}>
              {q.items.map((l, i) => <span key={i}>{i > 0 && " · "}{l.speciesName ?? l.speciesCode} {num(l.weightKg)}kg/{UNIT_LABEL[l.unit]} {l.grade}</span>)}
            </div>
            {q.lastError && <div className="err">⚠ {q.lastError}{/이미|중복|확정/.test(q.lastError) && <div className="mt-8">이 입고는 서버에 이미 있거나 확정되었습니다 — 필요하면 삭제 후 새 입고로 등록하세요.</div>}</div>}
            {canWrite && (
              <div className="flex mt-8" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn-ghost small" onClick={() => setRemoving(q)} disabled={busy !== null}>삭제</button>
                <button type="button" className="btn-secondary small" onClick={() => syncItem(q)} disabled={busy !== null || !online}>{busy === q.clientRef ? <span className="spinner" /> : "다시 시도"}</button>
              </div>
            )}
          </div>
        );
      })}

      {removing && <ConfirmModal title="대기열 삭제" danger confirmLabel="삭제" onClose={() => setRemoving(null)} onConfirm={doRemove} message={<>{removing.vesselName} 입고({removing.items.length}개 품목)를 대기열에서 삭제합니다. 서버에 저장되지 않은 데이터는 사라집니다.</>} />}
    </>
  );
}
