import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { AppError, assertContactFree, assertSpecies, digest } from "./auth";
import { publicOrigin } from "./config";
import { signupSchema } from "../lib/model";

const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
export const safeNext = (value: string | null | undefined) =>
  value?.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value)
    ? value
    : "/";
export function kakaoReady() {
  return !!(process.env.KAKAO_REST_API_KEY && process.env.KAKAO_CLIENT_SECRET);
}
function config() {
  if (!kakaoReady())
    throw new AppError("카카오 로그인 연결을 준비 중입니다.", 503);
  return {
    key: process.env.KAKAO_REST_API_KEY!,
    secret: process.env.KAKAO_CLIENT_SECRET!,
    redirect: new URL("/api/auth/kakao/callback", publicOrigin()).href,
  };
}
export async function startKakao(next?: string | null) {
  const c = config(),
    state = randomBytes(32).toString("hex");
  const jar = await cookies();
  const old = jar.get("mansun_kakao_state")?.value;
  if (old)
    await db()`DELETE FROM oauth_attempts WHERE token_hash=${digest(old)}`;
  await db()`DELETE FROM oauth_attempts WHERE expires_at<now()`;
  await db()`INSERT INTO oauth_attempts(token_hash,next_path,redirect_uri,expires_at) VALUES(${digest(state)},${safeNext(next)},${c.redirect},now()+interval '10 minutes')`;
  jar.set("mansun_kakao_state", state, { ...options, maxAge: 600 });
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: c.key,
    redirect_uri: c.redirect,
    response_type: "code",
    state,
  }).toString();
  return url.href;
}
async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db()`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${userId},now()+interval '30 days')`;
  (await cookies()).set("mansun_session", token, {
    ...options,
    maxAge: 30 * 86400,
  });
}
export async function finishKakao(params: URLSearchParams) {
  const jar = await cookies(),
    state = params.get("state"),
    saved = jar.get("mansun_kakao_state")?.value;
  if (!state || !saved || state !== saved)
    throw new AppError("로그인 요청이 만료됐습니다. 다시 시작해주세요.");
  jar.delete("mansun_kakao_state");
  const [attempt] =
    await db()`DELETE FROM oauth_attempts WHERE token_hash=${digest(state)} AND expires_at>now() RETURNING *`;
  if (!attempt || params.has("error") || !params.get("code"))
    throw new AppError("카카오 로그인이 취소되었거나 만료됐습니다.");
  const c = config();
  const response = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: c.key,
      client_secret: c.secret,
      redirect_uri: attempt.redirect_uri,
      code: params.get("code")!,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new AppError("카카오 인증을 완료하지 못했습니다. 다시 시도해주세요.");
  const token = await response.json();
  if (typeof token.access_token !== "string")
    throw new AppError("카카오 인증 응답을 확인할 수 없습니다.");
  const info = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!info.ok) throw new AppError("카카오 계정을 확인하지 못했습니다.");
  const account = await info.json();
  if (!Number.isSafeInteger(account.id) || account.id <= 0)
    throw new AppError("카카오 계정을 확인하지 못했습니다.");
  // No phone/email matching: only the provider-issued immutable ID authenticates a member.
  const subject = String(account.id);
  const [member] =
    await db()`SELECT m.* FROM oauth_identities i JOIN members m ON m.id=i.user_id WHERE i.provider='kakao' AND i.subject=${subject}`;
  if (member) {
    if (member.suspended) throw new AppError("이용이 제한된 계정입니다.", 403);
    await session(member.id);
    return safeNext(attempt.next_path);
  }
  const pending = randomBytes(32).toString("hex");
  await db()`DELETE FROM oauth_signups WHERE expires_at<now()`;
  await db()`INSERT INTO oauth_signups(token_hash,subject,expires_at) VALUES(${digest(pending)},${subject},now()+interval '30 minutes')`;
  jar.set("mansun_kakao_signup", pending, { ...options, maxAge: 1800 });
  return "/signup/kakao";
}
export async function pendingKakao() {
  const token = (await cookies()).get("mansun_kakao_signup")?.value;
  if (!token) return false;
  const [row] =
    await db()`SELECT token_hash FROM oauth_signups WHERE token_hash=${digest(token)} AND expires_at>now()`;
  return !!row;
}
export async function completeKakaoSignup(input: unknown) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.SERVICE_OPERATOR_NAME ||
      !process.env.SERVICE_OPERATOR_CONTACT)
  )
    throw new AppError(
      "운영자 정보를 준비 중입니다. 가입은 잠시 후 다시 시도해주세요.",
      503,
    );
  const data = signupSchema.parse(input),
    jar = await cookies(),
    token = jar.get("mansun_kakao_signup")?.value;
  if (!token) throw new AppError("카카오 로그인을 먼저 진행해주세요.", 401);
  const userId = await db().begin(async (sql) => {
    const [pending] =
      await sql`SELECT * FROM oauth_signups WHERE token_hash=${digest(token)} AND expires_at>now() FOR UPDATE`;
    if (!pending)
      throw new AppError(
        "가입 시간이 만료됐습니다. 카카오 로그인을 다시 진행해주세요.",
        401,
      );
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"kakao:" + pending.subject},0))`;
    const [existing] =
      await sql`SELECT m.id,m.suspended FROM oauth_identities i JOIN members m ON m.id=i.user_id WHERE provider='kakao' AND subject=${pending.subject}`;
    if (existing?.suspended)
      throw new AppError("이용이 제한된 계정입니다.", 403);
    let id = existing?.id;
    if (!id) {
      await assertContactFree(sql, data.profile.contact, null);
      await assertSpecies(sql, [
        ...data.profile.specialties,
        ...data.profile.interests.species,
      ]);
      const [member] =
        await sql`INSERT INTO members(phone,role,profile,approval) VALUES(NULL,${data.role},${sql.json(data.profile)},'approved') RETURNING id`;
      id = member.id;
      await sql`INSERT INTO oauth_identities(provider,subject,user_id) VALUES('kakao',${pending.subject},${id})`;
      await sql`INSERT INTO notifications(user_id,title,body,href) VALUES(${id},'전국 수산물 경매 정보방에 오신 것을 환영합니다',${data.role === "broker" ? "지금 바로 오늘 물건을 올릴 수 있습니다." : "관심 지역과 어종을 설정해보세요."},'/me/profile')`;
    }
    await sql`DELETE FROM oauth_signups WHERE subject=${pending.subject}`;
    return id as string;
  });
  await session(userId);
  jar.delete("mansun_kakao_signup");
  return { ok: true };
}
