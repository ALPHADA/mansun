const TZ = "Asia/Seoul";
export const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);
export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? "-" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
export const UNIT_LABEL: Record<string, string> = { kg: "kg", box: "박스", ea: "마리" };
export const unitLabel = (u: string) => UNIT_LABEL[u] ?? u;

export function fmtDateTime(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("ko-KR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, ...opts });
}
export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}
export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ko-KR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
}
export function fmtShortDate(d: Date | string | null | undefined) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ko-KR", { timeZone: TZ, month: "numeric", day: "numeric" });
}
/** Tenant 로컬(KST) 기준 YYYY-MM-DD */
export function localDateStr(d: Date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** KST 날짜 + "HH:mm" → Date */
export function kstDateTime(dateStr: string, hhmm: string) {
  return new Date(`${dateStr}T${hhmm}:00+09:00`);
}
/** datetime-local 입력값(KST 가정) → Date */
export function fromLocalInput(v: string) {
  return new Date(`${v}:00+09:00`.replace(/:00:00\+09:00$/, ":00+09:00"));
}
/** Date → datetime-local 값 (KST) */
export function toLocalInput(d: Date | null | undefined) {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}
export function remainingLabel(ms: number) {
  if (ms <= 0) return "마감";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
