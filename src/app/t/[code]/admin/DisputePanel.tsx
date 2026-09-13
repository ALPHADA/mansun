"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Badge } from "@/components/Badge";
import { fmtDateTime, won } from "@/lib/format";
import { decideDisputeAction } from "./actions";

export interface DisputeItem {
  id: string; kind: "reauction" | "objection"; reason: string; createdAt: string;
  auctionNo: string | null; speciesName: string; raisedByName: string; raisedRole: string; finalPrice: number | null;
}

export function DisputePanel({ code, items, canWrite }: { code: string; items: DisputeItem[]; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = (id: string, approve: boolean) => {
    if (approve && !confirm("승인하면 기존 낙찰/유찰 결과가 무효화되고 재개찰 대기 상태가 됩니다. 계속할까요?")) return;
    setBusyId(id);
    start(async () => {
      const r = await decideDisputeAction(code, id, approve, notes[id]);
      toast(r.ok ? r.message ?? "처리했습니다" : r.error);
      setBusyId(null);
      if (r.ok) router.refresh();
    });
  };

  if (items.length === 0) return <div className="empty-state" style={{ padding: "28px 20px" }}><div className="emoji">✅</div>승인 대기 중인 분쟁/재개찰 신청이 없습니다</div>;
  return (
    <div>
      {items.map((d) => (
        <div key={d.id} className="dispute-card">
          <div className="head">
            <div className="flex">
              <Badge tone={d.kind === "reauction" ? "warning" : "danger"}>{d.kind === "reauction" ? "재개찰 신청" : "선주 이의 제기"}</Badge>
              <b>{d.auctionNo ?? "(번호 미부여)"}</b> <span className="muted small">{d.speciesName}</span>
              {d.finalPrice != null && <span className="small">낙찰가 {won(d.finalPrice)}</span>}
            </div>
            <span className="muted small">{d.raisedByName} ({d.raisedRole}) · {fmtDateTime(d.createdAt)}</span>
          </div>
          <div className="reason">{d.reason}</div>
          {canWrite && (
            <div className="decide">
              <input placeholder="처리 의견 (선택)" value={notes[d.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} disabled={pending && busyId === d.id} />
              <button className="btn-primary" disabled={pending} onClick={() => decide(d.id, true)}>{pending && busyId === d.id ? <span className="spinner" /> : "승인"}</button>
              <button className="btn-secondary" disabled={pending} onClick={() => decide(d.id, false)}>거부</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
