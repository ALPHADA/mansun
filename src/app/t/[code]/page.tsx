import { redirect } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/context";
import { ROLE_HOME } from "@/lib/authz/matrix";

export default async function TenantHome({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  if (ctx.role) redirect(`/t/${code}${ROLE_HOME[ctx.role]}`);
  // Platform Admin 읽기 모드 → 운영자 대시보드(읽기 전용)
  redirect(`/t/${code}/operator/dashboard`);
}
