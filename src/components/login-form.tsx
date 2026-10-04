"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "./actions";
import { ArrowRight, ShieldCheck } from "./icons";
export function LoginForm({
  next,
  kakao = false,
}: {
  next: string;
  kakao?: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [signup, setSignup] = useState(kakao),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(""),
    [role, setRole] = useState("buyer");
  const [retryAt, setRetryAt] = useState(0);
  return (
    <form
      className="form login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const fd = new FormData(e.currentTarget);
        try {
          if (!challenge && !kakao) {
            const d = await api("auth/request", { phone });
            setChallenge(d.challengeId);
            setPreview(d.developmentCode || "");
            setRetryAt(Date.now() + 60000);
          } else {
            const payload: Record<string, unknown> = {
              challengeId: challenge,
              code,
            };
            if (signup) {
              const normalized = phone.replace(/[-\s]/g, "");
              payload.signup = {
                role,
                consent: fd.has("consent"),
                profile: {
                  name: fd.get("name"),
                  business: fd.get("business"),
                  industry: fd.get("industry"),
                  region: fd.get("region"),
                  market: fd.get("market") || "",
                  license: fd.get("license") || "",
                  contact: normalized,
                  hours: "06:00–18:00",
                  specialties: [],
                  interests: { regions: [], species: [] },
                },
              };
            }
            const result = await api(
              kakao ? "auth/kakao/signup" : "auth/verify",
              kakao ? payload.signup : payload,
            );
            if (result.needsSignup) setSignup(true);
            else {
              router.push(signup ? "/me/profile" : next);
              router.refresh();
            }
          }
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {kakao ? "업무 연락처" : "휴대폰 번호"}
        <input
          type="tel"
          name="phone"
          autoComplete="tel"
          required
          placeholder="010-0000-0000"
          value={phone}
          readOnly={!!challenge}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      {kakao && (
        <p className="form-note">
          카카오 인증이 완료됐습니다. 업무 연락처는 거래 연락용으로 직접
          입력하며, 문자 인증된 번호로 표시되지 않습니다.
        </p>
      )}
      {challenge && (
        <>
          <label>
            인증번호
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              placeholder="6자리 인증번호"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="form-note">
            인증번호는 5분 동안 유효합니다.
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                if (Date.now() < retryAt) {
                  setError("재발송은 이전 요청 후 60초 뒤에 가능합니다.");
                  return;
                }
                setBusy(true);
                try {
                  const d = await api("auth/request", { phone });
                  setChallenge(d.challengeId);
                  setPreview(d.developmentCode || "");
                  setRetryAt(Date.now() + 60000);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              재발송
            </button>
          </div>
          {preview && (
            <div className="notice">
              로컬 개발용 인증번호: <strong>{preview}</strong>
              <br />
              공개 배포 환경에서는 표시되지 않습니다.
            </div>
          )}
        </>
      )}
      {signup && (
        <>
          <div className="form-divider">
            <h3>처음 오셨네요. 회원 정보를 알려주세요.</h3>
          </div>
          <label>
            회원 유형
            <select
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="buyer">매입회원 — 물건을 찾고 싶어요</option>
              <option value="broker">중매인 — 물건을 판매해요</option>
            </select>
          </label>
          <div className="field-pair">
            <label>
              이름
              <input name="name" required maxLength={40} />
            </label>
            <label>
              상호
              <input name="business" required maxLength={80} />
            </label>
          </div>
          <label>
            업종
            <select name="industry">
              <option>차량판매</option>
              <option>수산물 소매</option>
              <option>수산물 도매</option>
              <option>냉동유통</option>
              <option>가공</option>
              <option>중매인</option>
            </select>
          </label>
          <label>
            활동 지역
            <input
              name="region"
              required
              placeholder="예: 충남 태안"
              maxLength={60}
            />
          </label>
          {role === "broker" && (
            <div className="field-pair">
              <label>
                소속 위판장
                <input name="market" required placeholder="예: 신진도 위판장" />
              </label>
              <label>
                중매인 번호
                <input name="license" required />
              </label>
            </div>
          )}
          <label className="check">
            <input type="checkbox" name="consent" required />
            <span>
              <Link href="/terms" target="_blank">
                이용약관
              </Link>{" "}
              및{" "}
              <Link href="/privacy" target="_blank">
                개인정보 처리 안내
              </Link>
              를 확인했습니다. 업무 연락처가 로그인 회원에게 공개되는 데
              동의합니다.
            </span>
          </label>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button full" disabled={busy}>
        {busy
          ? "확인 중…"
          : signup
            ? "가입하고 시작하기"
            : challenge
              ? "인증하고 로그인"
              : "인증번호 받기"}
        <ArrowRight size={19} />
      </button>
      <p className="login-reassurance">
        <ShieldCheck size={17} />
        중매인 등록 상품의 가격과 연락처는 로그인한 회원에게만 공개됩니다.
      </p>
    </form>
  );
}
