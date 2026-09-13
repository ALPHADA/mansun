import { getInvitation } from "@/services/auth";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { InviteForm } from "./InviteForm";

export const metadata = { title: "초청 수락" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getInvitation(token);
  return (
    <div className="auth-body">
      <div className="login-card">
        <div className="brand">
          <div className="logo">🐟</div>
          <h1>MANSUN 초청</h1>
          {found ? <p><b>{found.tenantName}</b> · {ROLE_LABEL[found.inv.role]} 로 초청되었습니다</p> : <p>유효하지 않거나 만료된 초청 링크입니다</p>}
        </div>
        {found && <InviteForm token={token} name={found.inv.name} email={found.inv.email} phone={found.inv.phone ?? ""} licenseNo={found.inv.licenseNo} />}
        {!found && <a href="/login" className="btn-secondary btn-block" style={{ display: "block", textAlign: "center" }}>로그인으로</a>}
      </div>
    </div>
  );
}
