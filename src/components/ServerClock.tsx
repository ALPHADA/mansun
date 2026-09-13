"use client";
import { createContext, useContext, useEffect, useState } from "react";

/** 서버 시각 오프셋(ms) — 클라이언트 시계 신뢰 금지 */
const OffsetCtx = createContext<number>(0);
export const useServerNow = () => {
  const offset = useContext(OffsetCtx);
  return () => Date.now() + offset;
};

export function ServerClockProvider({ children }: { children: React.ReactNode }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const t0 = Date.now();
      try {
        const r = await fetch("/api/time", { cache: "no-store" });
        const { now } = await r.json();
        const t1 = Date.now();
        if (alive) setOffset(now - (t0 + (t1 - t0) / 2));
      } catch { /* keep previous */ }
    };
    sync();
    const id = setInterval(sync, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return <OffsetCtx.Provider value={offset}>{children}</OffsetCtx.Provider>;
}
