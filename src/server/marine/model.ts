import { z } from "zod";
import { kstDay } from "../../lib/model";
import { validDay } from "../official/providers";

export const sources = {
  markets: {
    name: "해양수산부 · 위판장 위치",
    url: "https://www.data.go.kr/data/15056511/openapi.do",
    env: "MOF_SERVICE_KEY",
    schedule: "매주",
  },
  auction: {
    name: "해양수산부 · 일자별 위판",
    url: "https://www.data.go.kr/data/15057689/openapi.do",
    env: "AUCTION_SERVICE_KEY",
    schedule: "매일 06:30 · 12:30 · 18:30",
  },
  tide: {
    name: "국립해양조사원 · 고조/저조",
    url: "https://www.data.go.kr/data/15156018/openapi.do",
    env: "KHOA_SERVICE_KEY",
    schedule: "매일 00:20 · 향후 7일",
  },
  sea: {
    name: "기상청 · 해상예보",
    url: "https://www.data.go.kr/data/15058629/openapi.do",
    env: "KMA_SERVICE_KEY",
    schedule: "매시간",
  },
  land: {
    name: "기상청 · 항구 인근 육상예보",
    url: "https://www.data.go.kr/data/15084084/openapi.do",
    env: "KMA_SERVICE_KEY",
    schedule: "매시간",
  },
  warning: {
    name: "기상청 · 전국 특보현황",
    url: "https://www.data.go.kr/data/15000415/openapi.do",
    env: "KMA_SERVICE_KEY",
    schedule: "5분마다",
  },
  zones: {
    name: "기상청 · 예보구역",
    url: "https://www.data.go.kr/data/15057111/openapi.do",
    env: "KMA_SERVICE_KEY",
    schedule: "매주",
  },
} as const;
export type Source = keyof typeof sources;
// Station codes are supplied in server configuration after checking the official
// station registry. Matching response names are checked before publication.
export const ports = [
  {
    id: "sinjin",
    name: "신진도",
    region: "충남",
    station: "안흥",
    sea: "서해중부앞바다",
    lat: 36.6746,
    lon: 126.1296,
  },
  {
    id: "incheon",
    name: "인천",
    region: "인천",
    station: "인천",
    sea: "서해중부앞바다",
    lat: 37.451,
    lon: 126.592,
  },
  {
    id: "gunsan",
    name: "군산",
    region: "전북",
    station: "군산",
    sea: "서해남부앞바다",
    lat: 35.975,
    lon: 126.563,
  },
  {
    id: "mokpo",
    name: "목포",
    region: "전남",
    station: "목포",
    sea: "서해남부앞바다",
    lat: 34.779,
    lon: 126.376,
  },
  {
    id: "yeosu",
    name: "여수",
    region: "전남",
    station: "여수",
    sea: "남해서부앞바다",
    lat: 34.739,
    lon: 127.765,
  },
  {
    id: "tongyeong",
    name: "통영",
    region: "경남",
    station: "통영",
    sea: "남해동부앞바다",
    lat: 34.827,
    lon: 128.434,
  },
  {
    id: "busan",
    name: "부산",
    region: "부산",
    station: "부산",
    sea: "남해동부앞바다",
    lat: 35.096,
    lon: 129.035,
  },
  {
    id: "pohang",
    name: "포항",
    region: "경북",
    station: "포항",
    sea: "동해남부앞바다",
    lat: 36.047,
    lon: 129.377,
  },
  {
    id: "sokcho",
    name: "속초",
    region: "강원",
    station: "속초",
    sea: "동해중부앞바다",
    lat: 38.207,
    lon: 128.594,
  },
  {
    id: "jeju",
    name: "제주",
    region: "제주",
    station: "제주",
    sea: "제주도앞바다",
    lat: 33.527,
    lon: 126.543,
  },
] as const;
export type Port = (typeof ports)[number];
export function portFor(id?: string) {
  return ports.find((p) => p.id === id) ?? ports[0];
}
export function shiftDay(day: string, n: number) {
  return new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
}
export const daySchema = z.string().refine(validDay, "날짜를 확인해주세요.");
export function nextRun(source: Source, now = new Date()): Date {
  if (source === "warning") return new Date(now.getTime() + 300000);
  if (source === "sea" || source === "land")
    return new Date(now.getTime() + 3600000);
  if (source === "zones" || source === "markets")
    return new Date(now.getTime() + 7 * 86400000);
  const day = kstDay(now);
  const times = source === "tide" ? ["00:20"] : ["06:30", "12:30", "18:30"];
  for (const d of [day, shiftDay(day, 1)])
    for (const t of times) {
      const date = new Date(`${d}T${t}:00+09:00`);
      if (date > now) return date;
    }
  throw new Error("schedule");
}
export function tideCode(port: Port): string | undefined {
  try {
    return z
      .record(z.string(), z.string().regex(/^[A-Z]{2}_\d{4}$/))
      .parse(JSON.parse(process.env.KHOA_STATIONS || "{}"))[port.id];
  } catch {
    return undefined;
  }
}
// KMA Lambert conformal conic grid conversion (5 km).
export function grid(lat: number, lon: number) {
  const rad = Math.PI / 180,
    re = 6371.00877 / 5;
  const sn =
    Math.log(Math.cos(30 * rad) / Math.cos(60 * rad)) /
    Math.log(
      Math.tan(Math.PI / 4 + (60 * rad) / 2) /
        Math.tan(Math.PI / 4 + (30 * rad) / 2),
    );
  const sf =
    (Math.pow(Math.tan(Math.PI / 4 + (30 * rad) / 2), sn) *
      Math.cos(30 * rad)) /
    sn;
  const ro = (re * sf) / Math.pow(Math.tan(Math.PI / 4 + (38 * rad) / 2), sn);
  const ra = (re * sf) / Math.pow(Math.tan(Math.PI / 4 + (lat * rad) / 2), sn);
  const theta = (lon - 126) * rad * sn;
  return {
    nx: String(Math.floor(ra * Math.sin(theta) + 43.5)),
    ny: String(Math.floor(ro - ra * Math.cos(theta) + 136.5)),
  };
}
export function change(current: number | null, previous: number | null) {
  return {
    delta: current !== null && previous !== null ? current - previous : null,
    percent:
      current !== null && previous !== null && previous > 0
        ? ((current - previous) / previous) * 100
        : null,
    reason:
      current === null || previous === null
        ? "비교 기간 수집 미완료"
        : previous === 0
          ? "이전 기간 0 · 증감률 계산 불가"
          : null,
  };
}
