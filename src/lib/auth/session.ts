import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/db/schema";

export interface SessionPayload {
  userId: string;
  name: string;
  isPlatformAdmin: boolean;
  activeTenantId: string | null;
  activeTenantCode: string | null;
  activeRole: Role | null;
  /** 같은 Tenant 내 보유 역할 전체 */
  tenantRoles: Role[];
  /** Platform Admin 분쟁 조회 모드 (Tenant 도메인 읽기 허용) */
  readSessionId?: string | null;
  iat?: number;
  exp?: number;
}

const COOKIE = "mansun_session";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-secret-dev-secret-dev-secret-00");

export async function signSession(payload: SessionPayload, ttlSeconds = 60 * 60 * 12) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
