import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/server/auth";
import { unread } from "@/server/queries";
import { Brand } from "@/components/ui";
import {
  Bell,
  UserCircle,
  Plus,
  Fish,
  ClipboardText,
  ChartLine,
  Warehouse,
} from "@/components/icons";
import { Visit } from "@/components/actions";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "풍어 — 바다의 오늘, 거래의 시작", template: "%s | 풍어" },
  description:
    "전국 중매인의 오늘 물건과 수산물 가격을 확인하고 새로운 거래처를 만나세요.",
  robots: { index: false, follow: false },
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const count = await unread(user);
  return (
    <html lang="ko" data-scroll-behavior="smooth">
      <body>
        <a className="skip" href="#main">
          본문으로 이동
        </a>
        <div className="top-strip">
          <span>전국 수산물 거래처를 잇는 풍어</span>
          <Link href="/guide">
            풍어 이용 안내 <span>↗</span>
          </Link>
        </div>
        <header className="header">
          <div className="header-inner">
            <Brand />
            <nav className="desktop-nav" aria-label="주 메뉴">
              <Link href="/">오늘 물건</Link>
              <Link href="/requests">매입 요청</Link>
              <Link href="/market">지역 시세</Link>
              <Link href="/storage">보관업체</Link>
            </nav>
            <div className="header-actions">
              <Link
                href="/notifications"
                className="icon-button notification-button"
                aria-label={`알림 ${count}개`}
              >
                <Bell size={23} />
                {count > 0 && <span className="notification-dot" />}
              </Link>
              <Link href={user ? "/me" : "/login"} className="account-link">
                <UserCircle size={24} />
                <span>{user ? user.profile.name : "로그인"}</span>
              </Link>
              <Link
                href={
                  user?.role === "buyer" ? "/requests/new" : "/listings/new"
                }
                className="button small"
              >
                <Plus size={18} />
                <span>
                  {user?.role === "buyer" ? "매입 요청" : "물건 올리기"}
                </span>
              </Link>
            </div>
          </div>
        </header>
        <main id="main" className="main">
          {children}
        </main>
        <footer className="footer">
          <Brand />
          <p>바다에서 시작된 좋은 거래, 풍어에서 이어집니다.</p>
          <div>
            <Link href="/guide">이용 안내</Link>
            <Link href="/privacy">개인정보 처리 안내</Link>
            <Link href="/terms">이용약관</Link>
            {user?.admin && <Link href="/admin">운영 관리</Link>}
          </div>
          <small>
            풍어는 거래 당사자 간 연락을 연결합니다. 가격·수량·인수 조건은 거래
            전 직접 확인해주세요.
          </small>
        </footer>
        <nav className="mobile-nav" aria-label="모바일 메뉴">
          <Link href="/">
            <Fish size={23} />
            오늘 물건
          </Link>
          <Link href="/requests">
            <ClipboardText size={23} />
            매입 요청
          </Link>
          <Link href="/market">
            <ChartLine size={23} />
            지역 시세
          </Link>
          <Link href="/storage">
            <Warehouse size={23} />
            보관업체
          </Link>
          <Link href="/me">
            <UserCircle size={23} />내 정보
          </Link>
        </nav>
        {user && <Visit />}
      </body>
    </html>
  );
}
