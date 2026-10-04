import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { publicOrigin } from "./config";
import { phoneSchema, signupSchema, type User } from "../lib/model";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32)
    throw new AppError(
      "인증 설정을 확인하고 있습니다. 잠시 후 다시 시도해주세요.",
      503,
    );
  return s;
}
function codeHash(phone: string, code: string) {
  return createHmac("sha256", secret())
    .update(phone + ":" + code)
    .digest("hex");
}
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("mansun_session")?.value;
  if (!token) return null;
  const rows =
    await db()`SELECT m.* FROM sessions s JOIN members m ON m.id=s.user_id WHERE s.token_hash=${digest(token)} AND s.expires_at>now() AND NOT m.suspended`;
  return (rows[0] as User) || null;
}
export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new AppError("로그인이 필요합니다.", 401);
  return u;
}
export function requireAdmin(u: User) {
  if (!u.admin) throw new AppError("운영자 권한이 필요합니다.", 403);
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = publicOrigin();
  if (!origin || !allowed || origin !== new URL(allowed).origin)
    throw new AppError("허용되지 않은 요청입니다.", 403);
}
export function devSms(request: Request) {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_SMS_PREVIEW === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(request.url).hostname,
    ) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(request.headers.get("origin") || request.url).hostname,
    )
  );
}
export async function requestOtp(raw: unknown, request: Request) {
  const phone = phoneSchema.parse(raw);
  const preview = devSms(request);
  if (
    !preview &&
    (!process.env.SOLAPI_API_KEY ||
      !process.env.SOLAPI_API_SECRET ||
      !process.env.SOLAPI_FROM)
  )
    throw new AppError(
      "문자 인증 서비스를 준비 중입니다. 설정이 완료되면 가입과 로그인을 이용할 수 있습니다.",
      503,
    );
  if (
    !preview &&
    (!process.env.SERVICE_OPERATOR_NAME ||
      !process.env.SERVICE_OPERATOR_CONTACT)
  )
    throw new AppError(
      "테스트 운영자 정보를 준비 중입니다. 공개 가입 준비 후 이용할 수 있습니다.",
      503,
    );
  const code = String(randomInt(100000, 1000000));
  const row = await db().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(884310)`;
    const [r] =
      await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE phone=${phone})::int AS phone_count,count(*) FILTER(WHERE phone=${phone} AND created_at>now()-interval '60 seconds')::int AS recent FROM otp_challenges WHERE created_at>now()-interval '1 day'`;
    if (r.total >= 500 || r.phone_count >= 10 || r.recent > 0)
      throw new AppError(
        "인증 요청이 많습니다. 잠시 후 다시 시도해주세요.",
        429,
      );
    const [c] =
      await sql`INSERT INTO otp_challenges(phone,code_hash,expires_at) VALUES(${phone},${codeHash(phone, code)},now()+interval '5 minutes') RETURNING id`;
    return c;
  });
  if (!preview) {
    try {
      const date = new Date().toISOString(),
        salt = randomBytes(16).toString("hex");
      const signature = createHmac("sha256", process.env.SOLAPI_API_SECRET!)
        .update(date + salt)
        .digest("hex");
      const res = await fetch(
        "https://api.solapi.com/messages/v4/send-many/detail",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `HMAC-SHA256 apiKey=${process.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
          },
          body: JSON.stringify({
            messages: [
              {
                to: phone,
                from: process.env.SOLAPI_FROM,
                text: `[풍어] 인증번호 ${code} (5분 이내 입력)`,
                type: "SMS",
              },
            ],
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const body = await res.json();
      if (
        !res.ok ||
        body.failedMessageList?.length ||
        !body.groupInfo?.count?.registeredSuccess
      )
        throw new Error("SMS send failed");
    } catch {
      await db()`UPDATE otp_challenges SET consumed=true WHERE id=${row.id}`;
      throw new AppError(
        "문자를 보내지 못했습니다. 번호를 확인하고 다시 시도해주세요.",
        503,
      );
    }
  }
  return { challengeId: row.id, ...(preview ? { developmentCode: code } : {}) };
}
export async function verifyOtp(input: {
  challengeId: string;
  code: string;
  signup?: unknown;
}) {
  if (!/^[0-9a-f-]{36}$/.test(input.challengeId) || !/^\d{6}$/.test(input.code))
    throw new AppError("인증번호를 확인해주세요.");
  const token = randomBytes(32).toString("hex");
  const result = await db().begin(async (sql) => {
    const [c] =
      await sql`SELECT * FROM otp_challenges WHERE id=${input.challengeId} FOR UPDATE`;
    if (
      !c ||
      c.consumed ||
      c.attempts >= 5 ||
      new Date(c.expires_at) < new Date()
    )
      return { error: "인증번호가 만료됐습니다. 다시 요청해주세요." };
    await sql`UPDATE otp_challenges SET attempts=attempts+1 WHERE id=${c.id}`;
    if (c.code_hash !== codeHash(c.phone, input.code))
      return { error: "인증번호가 일치하지 않습니다." };
    let [u] = await sql`SELECT * FROM members WHERE phone=${c.phone}`;
    if (!u && !input.signup) return { needsSignup: true };
    if (!u) {
      const data = signupSchema.parse(input.signup);
      if (data.profile.contact !== c.phone)
        throw new AppError("연락처는 인증한 휴대폰 번호를 사용해주세요.");
      [u] =
        await sql`INSERT INTO members(phone,role,profile,approval) VALUES(${c.phone},${data.role},${sql.json(data.profile)},${data.role === "broker" ? "pending" : "approved"}) RETURNING *`;
      await sql`INSERT INTO notifications(user_id,title,body,href) VALUES(${u.id},'풍어에 오신 것을 환영합니다',${data.role === "broker" ? "운영자가 중매인 정보를 확인하면 물건을 올릴 수 있습니다." : "관심 지역과 어종을 설정하고 오늘 물건을 만나보세요."},'/me')`;
    }
    if (u.suspended) return { error: "이용이 제한된 계정입니다." };
    await sql`UPDATE otp_challenges SET consumed=true WHERE phone=${c.phone} AND NOT consumed`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${u.id},now()+interval '30 days')`;
    return { user: u };
  });
  if ("error" in result) throw new AppError(result.error!, 400);
  if ("needsSignup" in result) return { needsSignup: true };
  (await cookies()).set("mansun_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return { ok: true };
}
export async function logout() {
  const jar = await cookies(),
    token = jar.get("mansun_session")?.value;
  if (token) await db()`DELETE FROM sessions WHERE token_hash=${digest(token)}`;
  jar.delete("mansun_session");
}
