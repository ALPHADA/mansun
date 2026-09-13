"use client";
import { get, set } from "idb-keyval";
import type { BidUnit, Grade } from "@/db/schema";
import type { ActionResult } from "@/lib/errors";
import { dataUrlToBlob } from "./client-image";

export const QUEUE_KEY = "mansun:intake-queue";

export interface QueuedPhoto { dataUrl?: string; url?: string }
export interface QueuedLot {
  tankNo?: string | null; speciesCode: string; speciesName?: string; weightKg: number; unit: BidUnit; quantity?: number | null; grade: Grade; note?: string | null; photos: QueuedPhoto[];
}
export interface QueuedIntake {
  clientRef: string;
  tenantCode: string;
  vesselId: string; vesselName: string;
  arrivedAt: string;          // ISO
  roundId: string | null; roundLabel?: string | null;
  note?: string | null;
  confirm: boolean;           // 저장 후 확정 요청 여부
  items: QueuedLot[];
  queuedAt: string;           // ISO
  lastError?: string | null;
  lastTriedAt?: string | null;
}

export interface CreateIntakePayload {
  clientRef: string; vesselId: string; arrivedAt: string; roundId: string | null; note?: string | null;
  items: { tankNo?: string | null; speciesCode: string; weightKg: number; unit: BidUnit; quantity?: number | null; grade: Grade; note?: string | null; photos: string[] }[];
}

const safeGet = async (): Promise<QueuedIntake[]> => {
  try { return (await get<QueuedIntake[]>(QUEUE_KEY)) ?? []; } catch { return []; }
};
const safeSet = async (list: QueuedIntake[]) => { try { await set(QUEUE_KEY, list); } catch { /* IndexedDB 불가 환경 */ } };

export async function listQueue(tenantCode?: string) {
  const all = await safeGet();
  return tenantCode ? all.filter((q) => q.tenantCode === tenantCode) : all;
}
export async function queueCount(tenantCode?: string) { return (await listQueue(tenantCode)).length; }

export async function enqueue(item: QueuedIntake) {
  const all = await safeGet();
  const idx = all.findIndex((q) => q.clientRef === item.clientRef);
  if (idx >= 0) all[idx] = item; else all.push(item);
  await safeSet(all);
  notifyChange();
}
export async function removeQueued(clientRef: string) {
  await safeSet((await safeGet()).filter((q) => q.clientRef !== clientRef));
  notifyChange();
}
export async function updateQueued(clientRef: string, patch: Partial<QueuedIntake>) {
  const all = await safeGet();
  const idx = all.findIndex((q) => q.clientRef === clientRef);
  if (idx >= 0) { all[idx] = { ...all[idx], ...patch }; await safeSet(all); notifyChange(); }
}

/** 큐 변경 이벤트 (배지 갱신용) */
export const QUEUE_EVENT = "mansun:queue-changed";
function notifyChange() { if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT)); }

/** 서버 액션 fetch 실패(오프라인/네트워크) 판별 */
export function isNetworkError(e: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|Failed to|NetworkError|ECONN|timeout/i.test(msg);
}

export interface SyncHandlers {
  upload: (blob: Blob) => Promise<ActionResult<{ url: string }>>;
  create: (payload: CreateIntakePayload) => Promise<ActionResult<{ id: string; duplicate: boolean }>>;
  confirm?: (intakeId: string) => Promise<ActionResult<unknown>>;
}
export type SyncOutcome =
  | { clientRef: string; ok: true; intakeId: string; duplicate: boolean; confirmed: boolean; confirmError?: string }
  | { clientRef: string; ok: false; error: string; network: boolean };

/** 큐 1건 동기화: 사진 업로드 → createIntake(clientRef 멱등) → (옵션) 확정 */
export async function syncOne(item: QueuedIntake, h: SyncHandlers): Promise<SyncOutcome> {
  try {
    const items: CreateIntakePayload["items"] = [];
    let changed = false;
    for (const lot of item.items) {
      const photos: string[] = [];
      for (const p of lot.photos) {
        if (p.url) { photos.push(p.url); continue; }
        if (!p.dataUrl) continue;
        const r = await h.upload(dataUrlToBlob(p.dataUrl));
        if (!r.ok || !r.data) return fail(item, r.ok ? "사진 업로드 실패" : r.error, false);
        p.url = r.data.url; delete p.dataUrl; changed = true;
        photos.push(r.data.url);
      }
      items.push({ tankNo: lot.tankNo ?? null, speciesCode: lot.speciesCode, weightKg: lot.weightKg, unit: lot.unit, quantity: lot.quantity ?? null, grade: lot.grade, note: lot.note ?? null, photos });
    }
    if (changed) await updateQueued(item.clientRef, { items: item.items });
    const r = await h.create({ clientRef: item.clientRef, vesselId: item.vesselId, arrivedAt: item.arrivedAt, roundId: item.roundId, note: item.note ?? null, items });
    if (!r.ok || !r.data) {
      // 409/422 상당 (conflict/validation/state) → 큐 유지 + 사유 표시
      return fail(item, r.ok ? "저장 실패" : r.error, false);
    }
    const { id, duplicate } = r.data;
    let confirmed = false; let confirmError: string | undefined;
    if (item.confirm && h.confirm && !duplicate) {
      const c = await h.confirm(id);
      if (c.ok) confirmed = true; else confirmError = c.error;
    }
    await removeQueued(item.clientRef);
    return { clientRef: item.clientRef, ok: true, intakeId: id, duplicate, confirmed, confirmError };
  } catch (e) {
    const network = isNetworkError(e);
    return fail(item, network ? "네트워크 오류 — 연결 후 다시 시도" : (e instanceof Error ? e.message : "알 수 없는 오류"), network);
  }
}

async function fail(item: QueuedIntake, error: string, network: boolean): Promise<SyncOutcome> {
  await updateQueued(item.clientRef, { lastError: error, lastTriedAt: new Date().toISOString() });
  return { clientRef: item.clientRef, ok: false, error, network };
}

export async function syncAll(tenantCode: string, h: SyncHandlers): Promise<SyncOutcome[]> {
  const list = await listQueue(tenantCode);
  const out: SyncOutcome[] = [];
  for (const item of list) out.push(await syncOne(item, h));
  return out;
}

export function newClientRef() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
