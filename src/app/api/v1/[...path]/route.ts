import { completeKakaoSignup } from "@/server/kakao";
import { z } from "zod";
import {
  AppError,
  assertOrigin,
  currentUser,
  requireUser,
  requestOtp,
  verifyOtp,
  logout,
} from "@/server/auth";
import { mutate } from "@/server/mutations";
import * as q from "@/server/queries";
import { kstDay } from "@/lib/model";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
function failure(e: unknown) {
  if (e instanceof AppError) return json({ error: e.message }, e.status);
  if (e instanceof z.ZodError)
    return json({ error: e.issues[0]?.message || "입력을 확인해주세요." }, 400);
  console.error("API error", e instanceof Error ? e.message : "unknown");
  return json(
    { error: "처리하지 못했습니다. 잠시 후 다시 시도해주세요." },
    500,
  );
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path.join("/"),
      u = await currentUser();
    if (path === "taxonomy") return json(await q.taxonomy());
    if (path === "market") {
      await requireUser();
      const params = new URL(request.url).searchParams;
      const day = params.get("day") || kstDay();
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        Number.isNaN(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day
      )
        throw new AppError("날짜를 확인해주세요.");
      return json(
        await q.market(day, (params.get("region") || "").slice(0, 60)),
      );
    }
    if (path.startsWith("brokers/")) {
      const b = await q.broker(path.split("/")[1], u);
      return b ? json(b) : json({ error: "중매인을 찾을 수 없습니다." }, 404);
    }
    if (path === "me") return json({ user: u });
    if (path === "listings") {
      const url = new URL(request.url);
      return json(
        await q.listings(u, {
          region: url.searchParams.get("region") || undefined,
          species: url.searchParams.get("species") || undefined,
          q: url.searchParams.get("q")?.slice(0, 100) || undefined,
          state: url.searchParams.get("state") || undefined,
          page: Number(url.searchParams.get("page")) || 1,
        }),
      );
    }
    if (path.startsWith("listings/")) {
      const l = await q.listing(path.split("/")[1], u);
      return l ? json(l) : json({ error: "상품을 찾을 수 없습니다." }, 404);
    }
    if (path === "requests") return json(await q.requests(await requireUser()));
    if (path === "notifications")
      return json(await q.notifications(await requireUser()));
    return json({ error: "찾을 수 없습니다." }, 404);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    assertOrigin(request);
    const path = (await params).path.join("/");
    if (Number(request.headers.get("content-length") || 0) > 65536)
      throw new AppError("요청이 너무 큽니다.", 413);
    const raw = await request.text();
    if (raw.length > 65536) throw new AppError("요청이 너무 큽니다.", 413);
    let body;
    try {
      body = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
    } catch {
      throw new AppError("올바른 JSON 요청이 필요합니다.");
    }
    if (path === "auth/kakao/signup")
      return json(await completeKakaoSignup(body));
    if (path === "auth/request")
      return json(await requestOtp(body.phone, request));
    if (path === "auth/verify")
      return json(
        await verifyOtp(
          z
            .object({
              challengeId: z.string(),
              code: z.string(),
              signup: z.unknown().optional(),
            })
            .parse(body),
        ),
      );
    if (path === "auth/logout") {
      await logout();
      return json({ ok: true });
    }
    return json(await mutate(await requireUser(), path, body));
  } catch (e) {
    return failure(e);
  }
}
