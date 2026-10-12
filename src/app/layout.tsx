import { NavLink } from "@/components/nav-link";
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
  ChatCircleText,
  ChartLine,
  Compass,
} from "@/components/icons";
import { Visit } from "@/components/actions";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "전국 수산물 경매 정보방", template: "%s | 전국 수산물 경매 정보방" },
  description: "전국 수산물 위판 시세, 중매인 판매 상품과 매입 요청.",
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
        <header className="header">
          <div className="header-inner">
            <Brand />
            <nav className="desktop-nav" aria-label="주 메뉴">
              <NavLink href="/">오늘 물건</NavLink>
              <NavLink href="/market">지역 시세</NavLink>
              <NavLink href="/sea">바다정보</NavLink>
              <NavLink href="/board">자유게시판</NavLink>
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
              <Link
                href={user ? "/me" : "/login"}
                className="account-link"
                aria-label={user ? "내 정보" : "로그인"}
              >
                <UserCircle size={24} />
                <span>{user ? user.profile.name : "로그인"}</span>
              </Link>
              {(!user || user.role === "broker") && (
                <Link href="/listings/new" className="button small">
                  <Plus size={18} />
                  <span>물건 올리기</span>
                </Link>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="main">
          {children}
        </main>
        <footer className="footer">
          <Brand />
          <div>
            <Link href="/requests">매입 요청</Link>
            <Link href="/guide">이용 안내</Link>
            <Link href="/privacy">개인정보 처리 안내</Link>
            <Link href="/terms">이용약관</Link>
            {user?.admin && <Link href="/admin">운영 관리</Link>}
          </div>
          <small>
            전국 수산물 경매 정보방은 거래 당사자 간 연락을 연결합니다.
            가격·수량·인수 조건은 거래 전 직접 확인해주세요.
          </small>
        </footer>
        <nav className="mobile-nav" aria-label="모바일 메뉴">
          <NavLink href="/">
            <Fish size={23} />
            <span aria-label="오늘 물건">물건</span>
          </NavLink>
          <NavLink href="/market">
            <ChartLine size={23} />
            <span aria-label="지역 시세">시세</span>
          </NavLink>
          <NavLink href="/sea"><Compass size={23} />바다정보</NavLink>
          <NavLink href="/board">
            <ChatCircleText size={23} />
            <span aria-label="자유게시판">게시판</span>
          </NavLink>
          <NavLink href="/me">
            <UserCircle size={23} />내 정보
          </NavLink>
        </nav>
        {user && <Visit />}
      </body>
    </html>
  );
}
