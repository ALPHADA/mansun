import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listMembers, listInvitations } from "@/services/tenant-admin";
import { ROLE_LABEL, ROLE_PRIORITY } from "@/lib/authz/matrix";
import type { MembershipStatus, Role } from "@/db/schema";
import { MembersClient, type MemberItem, type InvitationItem } from "./MembersClient";

export const metadata = { title: "멤버 관리" };

const ROLES = ROLE_PRIORITY;
const STATUSES: MembershipStatus[] = ["invited", "active", "suspended"];

export default async function MembersPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "members.manage")) notFound();
  const role = ROLES.includes(sp.role as Role) ? (sp.role as Role) : undefined;
  const status = STATUSES.includes(sp.status as MembershipStatus) ? (sp.status as MembershipStatus) : undefined;
  const q = sp.q?.trim() || undefined;
  const [members, invitations] = await Promise.all([listMembers(ctx.tenant.id, { role, status, q }), listInvitations(ctx.tenant.id)]);
  const canWrite = !ctx.readOnly && hasPermission(ctx, "members.manage");
  const items: MemberItem[] = members.map((m) => ({
    ...m, lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
    memberships: m.memberships.map((x) => ({ ...x, joinedAt: x.joinedAt?.toISOString() ?? null, createdAt: x.createdAt.toISOString() })),
  }));
  const invs: InvitationItem[] = invitations.map((i) => ({ id: i.id, name: i.name, email: i.email, phone: i.phone, role: i.role, licenseNo: i.licenseNo, title: i.title, inviterName: i.inviterName, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString(), expired: i.expired }));

  return (
    <>
      <div className="panel">
        <form className="filter-bar" method="get">
          <div className="field"><label>역할</label>
            <select name="role" defaultValue={role ?? ""}><option value="">전체</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          <div className="field"><label>상태</label>
            <select name="status" defaultValue={status ?? ""}><option value="">전체</option><option value="active">활성</option><option value="invited">초청중</option><option value="suspended">정지</option></select></div>
          <div className="field grow"><label>검색</label><input name="q" defaultValue={q ?? ""} placeholder="이름·이메일·전화" /></div>
          <div className="actions"><button type="submit" className="btn-secondary">조회</button></div>
        </form>
        <MembersClient code={code} members={items} invitations={invs} canWrite={canWrite} currentUserId={ctx.session.userId} openInvite={sp.invite === "1"} />
      </div>
    </>
  );
}
