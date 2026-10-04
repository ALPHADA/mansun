import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import type postgres from "postgres";
import { db } from "./db";
import { publicOrigin } from "./config";
import {
  phoneSchema,
  plausiblePhone,
  signupSchema,
  type User,
} from "../lib/model";
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
const contactLock = (
  sql: postgres.Sql | postgres.TransactionSql,
  contact: string,
) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${"contact:" + contact},0))`;
// 문자 인증 없이 직접 입력하는 연락처는 가짜로 보이는 번호이거나 다른 회원의 인증 번호·연락처와 겹치면 안 된다.
// 이용 정지된 회원이 직접 입력해 둔 연락처는 점유로 치지 않아, 운영자가 선점 계정을 정지하면 실제 주인이 쓸 수 있다.
export async function contactTaken(
  sql: postgres.Sql | postgres.TransactionSql,
  contact: string,
  selfId: string | null,
) {
  await contactLock(sql, contact);
  const [taken] =
    await sql`SELECT id FROM members WHERE (phone=${contact} OR (profile->>'contact'=${contact} AND NOT suspended)) AND id IS DISTINCT FROM ${selfId}::uuid LIMIT 1`;
  return !!taken;
}
export async function assertContactFree(
  sql: postgres.Sql | postgres.TransactionSql,
  contact: string,
  selfId: string | null,
) {
  if (!plausiblePhone(contact))
    throw new AppError("실제 사용하는 휴대폰 번호를 입력해주세요.");
  if (await contactTaken(sql, contact, selfId))
    throw new AppError(
      "이미 다른 회원이 사용 중인 연락처입니다. 본인 번호가 맞다면 운영자에게 문의해주세요.",
      409,
    );
}
// 상품·요청·프로필(가입 포함)·보관업체의 어종은 운영 중인 어종 목록에 있어야 관심 어종 알림·검색과 이어진다.
export async function assertSpecies(
  sql: postgres.Sql | postgres.TransactionSql,
  names: string[],
) {
  const unique = [...new Set(names)];
  if (!unique.length) return;
  const rows = await sql<
    { name: string }[]
  >`SELECT name FROM taxonomy WHERE kind='species' AND active AND name IN ${sql(unique)}`;
  const known = new Set(rows.map((r) => r.name));
  const missing = unique.filter((n) => !known.has(n));
  if (missing.length)
    throw new AppError(
      `목록에 없는 어종입니다: ${missing.join(", ")}. 목록에서 고르거나 직접 추가한 뒤 선택해주세요.`,
    );
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
      await assertSpecies(sql, [
        ...data.profile.specialties,
        ...data.profile.interests.species,
      ]);
      // 문자로 소유를 확인한 가입이 우선한다. 같은 번호를 직접 입력해 둔 회원은 운영자가 확인하도록 남긴다.
      await contactLock(sql, c.phone);
      const squatters =
        await sql`SELECT id FROM members WHERE phone IS NULL AND NOT suspended AND profile->>'contact'=${c.phone}`;
      for (const s of squatters) {
        await sql`INSERT INTO audit_log(action,target,detail) VALUES('contact.conflict',${c.phone},${sql.json({ member: s.id, reason: "문자 인증으로 가입한 회원과 연락처가 같음" })})`;
        await sql`INSERT INTO notifications(user_id,title,body,href) VALUES(${s.id},'연락처를 확인해주세요','입력하신 업무 연락처가 다른 회원이 문자로 인증한 번호와 같습니다. 내 정보에서 본인 번호로 고쳐주세요.','/me/profile')`;
      }
      [u] =
        await sql`INSERT INTO members(phone,role,profile,approval) VALUES(${c.phone},${data.role},${sql.json(data.profile)},'approved') RETURNING *`;
      await sql`INSERT INTO notifications(user_id,title,body,href) VALUES(${u.id},'풍어에 오신 것을 환영합니다',${data.role === "broker" ? "지금 바로 오늘 물건을 올릴 수 있습니다." : "관심 지역과 어종을 설정하고 오늘 물건을 만나보세요."},'/me')`;
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
