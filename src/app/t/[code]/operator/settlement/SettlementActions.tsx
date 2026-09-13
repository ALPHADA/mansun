"use client";
import { useState } from "react";
import { ConfirmModal } from "@/components/Modal";
import { useAction } from "../_components/useAction";
import { confirmRoundSettlementsAction, generateSettlementsAction, markPaidAction } from "./actions";

export function SettlementActions({ code, roundId, roundLabel, pendingCount, awardedCount, openCount, adapter }:
  { code: string; roundId: string; roundLabel: string; pendingCount: number; awardedCount: number; openCount: number; adapter: string }) {
  const { busy, call, toast } = useAction();
  const [ask, setAsk] = useState(false);

  const generate = async () => {
    const r = await call(generateSettlementsAction(code, roundId), { silent: true });
    if (r.ok) toast(r.data === 0 ? "정산 대상(낙찰 물품)이 없습니다" : `정산 ${r.data}건 생성/재계산 완료`);
  };
  const confirm = async () => {
    const r = await call(confirmRoundSettlementsAction(code, roundId), { silent: true });
    setAsk(false);
    if (r.ok) toast(r.data.fail === 0 ? `✅ 정산 확정 ${r.data.ok}건 · 회계 시스템 전송 완료` : `⚠️ 확정 ${r.data.ok}건 · 회계 전송 실패 ${r.data.fail}건 — 재시도하세요`);
  };

  return (
    <>
      <button className="btn-secondary" type="button" onClick={generate} disabled={busy || awardedCount === 0} title={awardedCount === 0 ? "낙찰된 물품이 없습니다" : "대기 상태 정산을 다시 계산합니다"}>{busy ? <span className="spinner" /> : "정산 생성 / 재계산"}</button>
      <button className="btn-primary" type="button" onClick={() => setAsk(true)} disabled={busy || pendingCount === 0}>정산 확정 · 회계 연동</button>
      {ask && (
        <ConfirmModal title="정산 확정" confirmLabel="확정 · 전송" busy={busy} onClose={() => setAsk(false)} onConfirm={confirm}
          message={<>{roundLabel} 대기 정산 <strong>{pendingCount}건</strong>을 확정하고 회계 시스템({adapter})에 전송합니다.<br /><span className="muted small">확정 후 금액은 변경할 수 없으며, 당사자에게 정산서 발급 알림이 전송됩니다.</span></>}>
          {openCount > 0 && <p className="text-danger small" style={{ marginBottom: 0 }}>⚠️ 개찰이 끝나지 않은 물품 {openCount}건이 있어 확정이 거부됩니다.</p>}
        </ConfirmModal>
      )}
    </>
  );
}

export function MarkPaidButton({ code, settlementId }: { code: string; settlementId: string }) {
  const { busy, call } = useAction();
  return <button className="btn-secondary btn-sm" type="button" disabled={busy} onClick={() => call(markPaidAction(code, settlementId))}>{busy ? <span className="spinner" /> : "지급 완료"}</button>;
}
