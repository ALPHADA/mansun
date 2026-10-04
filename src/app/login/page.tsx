import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { smsReady } from "@/server/config";
import { kakaoReady, safeNext } from "@/server/kakao";
import { LoginForm } from "@/components/login-form";
import { Fish } from "@/components/icons";
export const metadata = { title: "로그인" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const p = await searchParams;
  if (await currentUser()) redirect("/me");
  const next = safeNext(p.next),
    ready = kakaoReady();
  const sms = smsReady() || process.env.NODE_ENV !== "production";
  return (
    <section className="auth-layout">
      <div className="auth-story">
        <Fish size={48} />
        <h1>
          오늘의 물건,
          <br />
          내일의 거래처.
        </h1>
        <p>
          수산업 종사자를 위한 새로운 연결.
          <br />
          카카오 계정으로 만선을 시작하세요.
        </p>
        <div className="auth-wave">滿船</div>
      </div>
      <div className="auth-panel">
        <span className="eyebrow">만선에 오신 것을 환영합니다</span>
        <h2>로그인 · 회원가입</h2>
        <p className="muted">
          카카오로 로그인하고 오늘의 가격과 거래처를 만나보세요.
        </p>
        {p.error && (
          <p className="notice error" role="alert">
            {p.error === "kakao_unavailable"
              ? "카카오 로그인 연결을 준비 중입니다."
              : "카카오 로그인이 취소되었거나 완료되지 않았습니다. 다시 시도해주세요."}
          </p>
        )}
        {ready ? (
          <a
            className="button full kakao-login"
            href={`/api/auth/kakao?next=${encodeURIComponent(next)}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 3C6.48 3 2 6.5 2 10.82c0 2.78 1.86 5.22 4.65 6.6l-1.18 4.32c-.1.35.3.63.6.43l5.18-3.44.75.02c5.52 0 10-3.5 10-7.83S17.52 3 12 3Z"
              />
            </svg>
            카카오 로그인
          </a>
        ) : (
          <div className="notice">
            카카오 로그인 연결을 준비하고 있습니다. 상품과 서비스 소개는 바로
            둘러볼 수 있습니다.
          </div>
        )}
        <p className="form-note">
          처음 방문하셨다면 회원 유형과 업무 정보를 입력합니다. 카카오톡
          메시지는 발송하지 않습니다.
        </p>
        {sms && (
          <details className="sms-login" open={!ready}>
            <summary>휴대폰 번호로 로그인</summary>
            <LoginForm next={next} />
          </details>
        )}
      </div>
    </section>
  );
}
