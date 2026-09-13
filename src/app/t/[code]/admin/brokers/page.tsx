import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listBrokers } from "@/services/tenant-admin";
import { BrokerTable, type BrokerItem } from "./BrokerTable";

export const metadata = { title: "중매인 면허 관리" };

export default async function BrokersPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "members.manage")) notFound();
  const rows = await listBrokers(ctx.tenant.id);
  const canWrite = !ctx.readOnly && hasPermission(ctx, "members.manage");
  const items: BrokerItem[] = rows.map((r) => ({ ...r, joinedAt: r.joinedAt?.toISOString() ?? null, lastAwardedAt: r.lastAwardedAt?.toISOString() ?? null }));
  const expiring = rows.filter((r) => r.licenseStatus === "active" && r.daysLeft != null && r.daysLeft <= 30).length;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>중매인 면허 <span className="muted small">{rows.length}명{expiring > 0 && <> · <span className="text-danger">만료 임박 {expiring}</span></>}</span></h2>
        {canWrite && <Link href={`/t/${code}/admin/members?invite=1`} className="btn-primary" style={{ display: "inline-block" }}>+ 면허 등록(중매인 초청)</Link>}
      </div>
      <div className="panel-body dense">
        <BrokerTable code={code} rows={items} canWrite={canWrite} />
      </div>
    </div>
  );
}
