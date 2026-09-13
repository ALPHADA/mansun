"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

/** dev 전용: 스케줄러 tick 강제 실행 */
export function TickButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter(); const toast = useToast();
  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/internal/tick", { method: "POST" });
      const j = (await r.json()) as { skipped?: boolean; log?: string[] };
      toast(j.skipped ? "tick 실행 중 — 잠시 후 다시 시도" : `tick 완료 · ${j.log?.length ?? 0}건 처리`);
      router.refresh();
    } catch { toast("tick 실행 실패"); } finally { setBusy(false); }
  };
  return <button className="btn-secondary btn-sm" type="button" onClick={run} disabled={busy} title="스케줄러 1회 실행 (dev)">{busy ? <span className="spinner" /> : "⏱ 지금 tick 실행"}</button>;
}
