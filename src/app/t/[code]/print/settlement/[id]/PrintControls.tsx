"use client";
import { useRouter } from "next/navigation";

export function PrintControls({ backHref }: { backHref: string }) {
  const router = useRouter();
  return (
    <div className="print-actions no-print">
      <button className="btn-secondary" type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push(backHref))}>← 뒤로</button>
      <button className="btn-primary" type="button" onClick={() => window.print()}>🖨 인쇄</button>
    </div>
  );
}
