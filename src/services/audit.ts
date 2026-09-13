import "server-only";
import { db, type DbOrTx } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { headers } from "next/headers";

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

async function clientIp() {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
  } catch { return "system"; }
}

export async function audit(entry: AuditEntry, tx: DbOrTx = db) {
  await tx.insert(auditLogs).values({
    tenantId: entry.tenantId ?? null,
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip: await clientIp(),
  });
}
