import { finishKakao } from "@/server/kakao";
import { publicOrigin } from "@/server/config";
export async function GET(request: Request) {
  let next: string;
  try {
    next = await finishKakao(new URL(request.url).searchParams);
  } catch {
    next = "/login?error=kakao_failed";
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(next, publicOrigin()).href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
