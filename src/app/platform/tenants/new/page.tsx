import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { NewTenantForm } from "./NewTenantForm";

export const metadata = { title: "수협 등록" };

export default async function NewTenantPage() {
  await requirePlatformAdmin();
  return (
    <>
      <div className="pf-head">
        <div><h2>수협(Tenant) 등록</h2><div className="sub">셀프 가입은 허용하지 않습니다 — Platform Admin 이 사전 검토 후 수동 생성 · <Link href="/platform/tenants">← 목록</Link></div></div>
      </div>
      <div className="panel">
        <div className="panel-header"><h2>신규 수협 정보</h2><span className="muted small">생성 시 상태 = 준비중(pending)</span></div>
        <div className="panel-body"><NewTenantForm /></div>
      </div>
    </>
  );
}
