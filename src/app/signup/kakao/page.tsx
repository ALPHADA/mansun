import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { pendingKakao } from "@/server/kakao";
import { LoginForm } from "@/components/login-form";
export const metadata = { title: "회원 정보 입력" };
export default async function Signup() {
  if (await currentUser()) redirect("/me");
  if (!(await pendingKakao())) redirect("/login");
  return (
    <section className="narrow">
      <span className="eyebrow">카카오 인증 완료</span>
      <h1>전국 수산물 경매 정보방에서 어떻게 활동하시나요?</h1>
      <p className="muted">처음 한 번만 회원 정보를 입력해주세요.</p>
      <LoginForm next="/me/profile" kakao />
    </section>
  );
}
