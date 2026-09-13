import Link from "next/link";
export default function NotFound() {
  return (
    <div className="auth-body">
      <div className="login-card" style={{ textAlign: "center" }}>
        <div className="brand"><div className="logo">🐟</div><h1>페이지를 찾을 수 없습니다</h1><p>주소가 잘못되었거나 접근 권한이 없는 수협입니다.</p></div>
        <Link href="/" className="btn-primary btn-block" style={{ display: "block" }}>홈으로</Link>
      </div>
    </div>
  );
}
