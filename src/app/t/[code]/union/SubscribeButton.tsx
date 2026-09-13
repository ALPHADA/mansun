"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { toggleSubscriptionAction } from "./actions";

export function SubscribeButton({ code, roundId, initial, disabled }: { code: string; roundId: string; initial: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const toggle = () => start(async () => {
    const r = await toggleSubscriptionAction(code, roundId);
    if (!r.ok) { toast(r.error); return; }
    const next = r.data?.subscribed ?? !on;
    setOn(next);
    toast(next ? "이 회차 알림을 받습니다 (시각 변경·취소·입고 마감)" : "회차 알림을 해제했습니다");
    router.refresh();
  });
  return (
    <button type="button" className={`btn-sub${on ? " on" : ""}`} onClick={toggle} disabled={pending || disabled} aria-pressed={on}>
      {pending ? <span className="spinner" /> : on ? "🔔 알림 받는 중" : "🔕 이 회차 알림 받기"}
    </button>
  );
}
