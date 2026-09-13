"use client";
import type { SyncHandlers } from "@/lib/offline-queue";
import { createIntakeAction, confirmIntakeAction, uploadPhotoAction } from "./actions";

/** 오프라인 큐 동기화용 서버 액션 어댑터 (신규 입고 폼·대기열 공용) */
export function makeHandlers(code: string): SyncHandlers {
  return {
    upload: (blob) => { const fd = new FormData(); fd.append("file", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" })); return uploadPhotoAction(code, fd); },
    create: (payload) => createIntakeAction(code, payload),
    confirm: (id) => confirmIntakeAction(code, id),
  };
}
