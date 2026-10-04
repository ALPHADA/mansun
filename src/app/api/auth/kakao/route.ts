import { startKakao } from "@/server/kakao";
import { publicOrigin } from "@/server/config";
export async function GET(request: Request) {
  try {
    const href = await startKakao(
      new URL(request.url).searchParams.get("next"),
    );
    return new Response(null, {
      status: 303,
      headers: { Location: href, "Cache-Control": "no-store" },
    });
  } catch {
    return Response.redirect(
      new URL("/login?error=kakao_unavailable", publicOrigin()),
      303,
    );
  }
}
