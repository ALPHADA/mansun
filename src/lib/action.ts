import "server-only";
import { toActionError, type ActionResult } from "./errors";

/** 서버 액션 래퍼: 도메인 에러 → ActionResult. redirect()는 통과시킴 */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e;
    return toActionError(e);
  }
}
