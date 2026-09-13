import { NextResponse, type NextRequest } from "next/server";

/** 서버 컴포넌트에서 현재 경로를 알 수 있도록 요청 헤더에 x-pathname 주입 (테넌트 전환 후 원래 경로 복귀용) */
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname + (req.nextUrl.search || ""));
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/t/:path*", "/platform/:path*"] };
