"use client";
import { useEffect, useState } from "react";
import { useServerNow } from "./ServerClock";
import { remainingLabel } from "@/lib/format";

export function Countdown({ until, className = "countdown", coolAfterMs = 60_000, onExpire, prefix = "" }:
  { until: string | Date; className?: string; coolAfterMs?: number; onExpire?: () => void; prefix?: string }) {
  const now = useServerNow();
  const target = typeof until === "string" ? new Date(until).getTime() : until.getTime();
  const [ms, setMs] = useState(() => target - now());
  useEffect(() => {
    const id = setInterval(() => {
      const left = target - now();
      setMs(left);
      if (left <= 0) { clearInterval(id); onExpire?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [target, now, onExpire]);
  const cool = ms > coolAfterMs;
  return <span className={`${className}${cool ? " cool" : ""}`}>{prefix}{remainingLabel(ms)}</span>;
}
