"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { setGlobalSuspendedAction } from "./actions";

export function UserActions({ userId, name, globalSuspended, isPlatformAdmin, tenantNames }: { userId: string; name: string; globalSuspended: boolean; isPlatformAdmin: boolean; tenantNames: string[] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const suspend = !globalSuspended;
  const ok = reason.trim().length >= 5;
  const close = () => { setOpen(false); setReason(""); setError(null); };
  const submit = () => start(async () => {
    const r = await setGlobalSuspendedAction(userId, suspend, reason);
    if (!r.ok) { setError(r.error); return; }
    toast(r.message ?? "완료");
    close();
    router.refresh();
  });

  if (isPlatformAdmin && suspend) return <span className="muted small">Platform Admin 계정은 글로벌 정지 대상이 아닙니다 (별도 SOP)</span>;
  return (
    <>
      {suspend
        ? <button className="btn-danger" onClick={() => setOpen(true)}>⚠ 글로벌 정지</button>
        : <button className="btn-primary" onClick={() => setOpen(true)}>▶ 글로벌 정지 해제</button>}
      {open && (
        <Modal title={suspend ? "⚠ 사용자 글로벌 정지" : "글로벌 정지 해제"} onClose={close} footer={<>
          <button className="btn-secondary" onClick={close} disabled={pending}>취소</button>
          <button className={suspend ? "btn-danger" : "btn-primary"} disabled={!ok || pending} onClick={submit}>{pending ? <span className="spinner" /> : suspend ? "정지" : "해제"}</button>
        </>}>
          {suspend ? (
            <div className="danger-box">
              <b>{name}</b> 의 로그인이 차단되고, 소속된 모든 수협({tenantNames.length ? tenantNames.join(", ") : "없음"})의 활성 Membership 이 일괄 <b>정지</b>됩니다. 진행 중인 입찰은 개찰 시 유효하나 새 입찰·조회는 불가합니다.
            </div>
          ) : (
            <div className="warn-box">
              <b>{name}</b> 의 로그인이 다시 허용됩니다. 글로벌 정지 당시 활성이었던 Membership 만 복원되며, 수협 Admin 이 개별적으로 정지한 Membership 은 그대로 유지됩니다.
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="modal-field">
            <label>사유 <span className="text-danger">*</span> <span className="muted">(5자 이상 · 감사 로그 기록)</span></label>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={suspend ? "예: 복수 수협에서 허위 입찰 반복 (민원 #M-2026-0051)" : "예: 소명 자료 검토 완료, 정지 해제"} />
            <div className={`count${ok ? "" : " bad"}`}>{reason.trim().length}/5</div>
          </div>
        </Modal>
      )}
    </>
  );
}
