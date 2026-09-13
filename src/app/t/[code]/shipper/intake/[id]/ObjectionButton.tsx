"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { raiseObjectionAction } from "../../actions";

export function ObjectionButton({ code, auctionId, label, deadline }: { code: string; auctionId: string; label: string; deadline: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const ok = reason.trim().length >= 5;
  const close = () => { setOpen(false); setReason(""); setError(null); };
  const submit = () => start(async () => {
    const r = await raiseObjectionAction(code, auctionId, reason);
    if (!r.ok) { setError(r.error); return; }
    toast(r.message ?? "접수됨");
    close();
    router.refresh();
  });
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>이의 제기</button>
      {open && (
        <Modal title="이의 제기" onClose={close} footer={<>
          <button className="btn-secondary" onClick={close} disabled={pending}>취소</button>
          <button className="btn-danger" disabled={!ok || pending} onClick={submit}>{pending ? <span className="spinner" /> : "이의 제기 접수"}</button>
        </>}>
          <p style={{ marginTop: 0 }}><b>{label}</b> 의 낙찰/유찰 결과에 이의를 제기합니다. 운영자에게 즉시 전달되며, 검토 후 재개찰 신청 또는 기각 결과를 알림으로 받습니다.</p>
          <div className="notice-box">⏱ 이의 제기는 낙찰 후 <b>24시간 이내</b>에만 가능합니다{deadline ? ` (마감 ${deadline})` : ""}. 접수 후 취소는 운영자에게 문의하세요.</div>
          {error && <div className="form-error">{error}</div>}
          <label>사유 <span className="text-danger">*</span> <span className="muted">(5자 이상)</span></label>
          <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 현장 호가가 디지털 최고가보다 높았는데 반영되지 않음" />
          <div className={`small text-right${ok ? " muted" : " text-danger"}`}>{reason.trim().length}/5</div>
        </Modal>
      )}
    </>
  );
}
