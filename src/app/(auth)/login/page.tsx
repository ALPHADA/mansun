import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; joined?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) redirect(session.activeTenantCode ? `/t/${session.activeTenantCode}` : session.isPlatformAdmin ? "/select-tenant" : "/select-tenant");
  return (
    <div className="auth-body">
      <div className="login-card">
        <div className="brand">
          <div className="logo">🐟</div>
          <h1>MANSUN</h1>
          <p>수산물 위판 경매 디지털 플랫폼</p>
        </div>
        {sp.joined && <div className="form-success">가입이 완료되었습니다. 로그인하세요.</div>}
        <LoginForm next={sp.next} />
        {process.env.NODE_ENV !== "production" && (
          <details className="mt-16 small muted">
            <summary>개발용 시드 계정</summary>
            <div style={{ lineHeight: 1.8, marginTop: 6 }}>
              비밀번호 공통 <code>mansun1234</code><br />
              platform@mansun.kr · admin@gangu.kr · operator@gangu.kr · receiver@gangu.kr<br />
              broker@gangu.kr(강구+포항) · shipper1@gangu.kr · union@gangu.kr · admin@pohang.kr
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
