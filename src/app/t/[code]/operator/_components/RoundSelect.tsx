"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface RoundOption { id: string; label: string; hint?: string }

/** 회차 선택 → ?round= 쿼리로 이동 (다른 쿼리는 유지) */
export function RoundSelect({ options, value, param = "round", emptyLabel = "회차 없음" }: { options: RoundOption[]; value: string | null; param?: string; emptyLabel?: string }) {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(sp.toString());
    next.set(param, e.target.value);
    router.push(`${pathname}?${next.toString()}`);
  };
  if (options.length === 0) return <span className="muted small">{emptyLabel}</span>;
  return (
    <select className="select-inline" value={value ?? ""} onChange={onChange} aria-label="회차 선택">
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.hint ? ` · ${o.hint}` : ""}</option>)}
    </select>
  );
}
