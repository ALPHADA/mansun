"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { ActionResult } from "@/lib/errors";

/** 서버 액션 호출 공통: 토스트 + refresh. 성공 시 data 반환 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const router = useRouter(); const toast = useToast();
  const call = useCallback(async <T,>(p: Promise<ActionResult<T>>, opts: { refresh?: boolean; silent?: boolean } = {}) => {
    setBusy(true);
    try {
      const r = await p;
      if (!r.ok) { toast(r.error); return { ok: false as const, error: r.error, code: r.code }; }
      if (!opts.silent) toast(r.message ?? "완료되었습니다");
      if (opts.refresh !== false) router.refresh();
      return { ok: true as const, data: r.data as T };
    } finally { setBusy(false); }
  }, [router, toast]);
  return { busy, call, toast, router };
}
