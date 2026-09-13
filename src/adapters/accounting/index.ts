import "server-only";
import { db } from "@/db/client";
import { notificationLogs } from "@/db/schema";
import type { AccountingAdapter, SettlementExport } from "./types";

const mock: AccountingAdapter = {
  name: "mock",
  async push(tenantId: string, data: SettlementExport) {
    const ref = `ERP-${data.settlementNo}`;
    await db.insert(notificationLogs).values({
      tenantId, channel: "erp", recipient: "mock://suhyup-erp", subject: data.settlementNo, payload: data as unknown as Record<string, unknown>, status: "sent",
    });
    return { ok: true, ref };
  },
};

const registry: Record<string, AccountingAdapter> = { mock };
export function getAccountingAdapter(name: string | null | undefined): AccountingAdapter {
  return registry[name ?? "mock"] ?? mock;
}
