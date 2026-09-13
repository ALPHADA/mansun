"use client";
import { useState } from "react";
import Link from "next/link";
import type { AuctionStatus } from "@/db/schema";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useAction } from "../_components/useAction";
import { openAllClosedAction, openAuctionAction, requestReauctionAction } from "./actions";

interface RowProps { code: string; auctionId: string; auctionNo: string; roundId: string; status: AuctionStatus; hasField: boolean; hybrid: boolean; canOpen: boolean; canReauction: boolean }

export function RowActions({ code, auctionId, auctionNo, roundId, status, hasField, hybrid, canOpen, canReauction }: RowProps) {
  const { busy, call } = useAction();
  const [askNoField, setAskNoField] = useState(false);
  const [reauction, setReauction] = useState<string | null>(null);

  const open = async (withoutField = false) => {
    const r = await call(openAuctionAction(code, auctionId, withoutField));
    if (!r.ok && r.code === "state" && r.error.includes("현장 결과")) setAskNoField(true);
    else setAskNoField(false);
  };
  const submitReauction = async () => {
    if (reauction == null) return;
    const r = await call(requestReauctionAction(code, auctionId, reauction));
    if (r.ok) setReauction(null);
  };

  if (status === "closed_digital" || status === "field_open") {
    return (
      <>
        {hybrid && canOpen && <Link href={`/t/${code}/operator/field-result?round=${roundId}&auction=${auctionId}`} className="btn-secondary btn-sm" style={{ display: "inline-block" }}>{hasField ? "현장 결과 수정" : "현장 결과 입력"}</Link>}
        {canOpen && <button className="btn-primary btn-sm" type="button" disabled={busy} onClick={() => open(false)}>{busy ? <span className="spinner" /> : "개찰"}</button>}
        {askNoField && (
          <ConfirmModal title={`디지털만으로 개찰 · ${auctionNo}`} confirmLabel="디지털만으로 개찰" busy={busy} onClose={() => setAskNoField(false)} onConfirm={() => open(true)}
            message={<>현장 결과가 입력되지 않았습니다.<br />현장 결과 없이 <strong>디지털 입찰만으로</strong> 개찰할까요? (감사 로그에 기록됩니다)</>} />
        )}
      </>
    );
  }
  if (status === "rebid") {
    return canOpen ? <button className="btn-primary btn-sm" type="button" disabled={busy} onClick={() => open(false)}>{busy ? <span className="spinner" /> : "재입찰 종료 후 개찰"}</button> : null;
  }
  if (status === "awarded" || status === "passed") {
    if (!canReauction) return <span className="muted">—</span>;
    return (
      <>
        <button className="btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setReauction("")}>재개찰 신청</button>
        {reauction != null && (
          <Modal title={`재개찰 신청 · ${auctionNo}`} onClose={() => setReauction(null)} footer={<>
            <button className="btn-secondary" type="button" onClick={() => setReauction(null)} disabled={busy}>취소</button>
            <button className="btn-danger" type="button" onClick={submitReauction} disabled={busy || reauction.trim().length < 5}>{busy ? <span className="spinner" /> : "신청"}</button>
          </>}>
            <p style={{ marginTop: 0 }}>수협 관리자 승인 후 결과가 무효화되고 재개찰 대기 상태가 됩니다. 재개찰은 회차당 1회만 가능합니다.</p>
            <label>사유 * <span className="muted">(5자 이상, 감사 로그 기록)</span></label>
            <textarea rows={3} value={reauction} onChange={(e) => setReauction(e.target.value)} placeholder="예: 중매인 분쟁 제기 — 현장 호가 기록 불일치" />
          </Modal>
        )}
      </>
    );
  }
  return <span className="muted">—</span>;
}

export function BulkOpenButton({ code, roundId, count }: { code: string; roundId: string; count: number }) {
  const { busy, call, toast } = useAction();
  const [ask, setAsk] = useState(false);
  const go = async () => {
    const r = await call(openAllClosedAction(code, roundId), { silent: true });
    setAsk(false);
    if (r.ok) toast(`✅ ${r.data}건 일괄 개찰 완료 · 결과 통보 발송`);
  };
  return (
    <>
      <button className="btn-primary" type="button" disabled={busy || count === 0} onClick={() => setAsk(true)}>{busy ? <span className="spinner" /> : `전체 일괄 개찰${count ? ` (${count})` : ""}`}</button>
      {ask && <ConfirmModal title="전체 일괄 개찰" confirmLabel="일괄 개찰" busy={busy} onClose={() => setAsk(false)} onConfirm={go}
        message={<>개찰 대기중인 <strong>{count}건</strong>을 일괄 개찰합니다.<br /><span className="muted small">현장 결과가 없는 물품은 디지털 입찰만으로 개찰됩니다. 재입찰 진행중 물품은 제외됩니다.</span></>} />}
    </>
  );
}
