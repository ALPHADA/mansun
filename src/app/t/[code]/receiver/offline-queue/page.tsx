import Link from "next/link";
import { requireTenantContext, hasPermission } from "@/lib/auth/context";
import { OfflineQueueClient } from "./OfflineQueueClient";

export const metadata = { title: "오프라인 대기열" };

export default async function OfflineQueuePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  const canWrite = !ctx.readOnly && hasPermission(ctx, "intake.write");
  return (
    <>
      <div className="flex mb-8"><Link href={`/t/${code}/receiver`} className="back-btn" style={{ fontSize: 18 }}>‹</Link><h2 style={{ fontSize: 16 }}>오프라인 대기열</h2></div>
      <OfflineQueueClient code={code} canWrite={canWrite} />
    </>
  );
}
