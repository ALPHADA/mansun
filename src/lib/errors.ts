export class AppError extends Error {
  constructor(public code: "unauthorized" | "forbidden" | "not_found" | "conflict" | "validation" | "state", message: string) {
    super(message);
    this.name = "AppError";
  }
}
export const forbidden = (msg = "권한이 없습니다") => new AppError("forbidden", msg);
export const notFound = (msg = "찾을 수 없습니다") => new AppError("not_found", msg);
export const conflict = (msg: string) => new AppError("conflict", msg);
export const validation = (msg: string) => new AppError("validation", msg);
export const stateError = (msg: string) => new AppError("state", msg);

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code?: AppError["code"]; fieldErrors?: Record<string, string> };

export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof AppError) return { ok: false, error: e.message, code: e.code };
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    const fieldErrors: Record<string, string> = {};
    for (const i of issues) fieldErrors[String(i.path[0] ?? "_")] = i.message;
    return { ok: false, error: issues[0]?.message ?? "입력값을 확인하세요", code: "validation", fieldErrors };
  }
  console.error(e);
  return { ok: false, error: "처리 중 오류가 발생했습니다" };
}
