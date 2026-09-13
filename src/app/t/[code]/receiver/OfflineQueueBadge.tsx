"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { queueCount, QUEUE_EVENT } from "@/lib/offline-queue";

export function OfflineQueueBadge({ code }: { code: string }) {
  const [n, setN] = useState(0);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const refresh = () => { queueCount(code).then(setN); setOnline(navigator.onLine); };
    refresh();
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener(QUEUE_EVENT, refresh); window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); window.removeEventListener("focus", refresh); };
  }, [code]);
  if (n === 0 && online) return null;
  return (
    <Link href={`/t/${code}/receiver/offline-queue`} className="offline-pill" style={!online ? { background: "#fee2e2", color: "#991b1b" } : undefined}>
      {online ? "📶" : "📵 오프라인"} {n > 0 ? `동기화 대기 ${n}건` : ""}
    </Link>
  );
}
