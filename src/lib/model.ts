import { z } from "zod";
export const roles = ["broker", "buyer"] as const;
// Retain historical member roles without offering new storage registrations.
export type Role = (typeof roles)[number] | "storage";
export const roleNames: Record<Role, string> = {
  broker: "중매인",
  buyer: "매입회원",
  storage: "기존 회원",
};
export const provinces = [
  "인천",
  "경기",
  "강원",
  "충남",
  "충북",
  "대전",
  "세종",
  "전북",
  "전남",
  "광주",
  "경북",
  "경남",
  "대구",
  "울산",
  "부산",
  "제주",
  "서울",
];
export const defaultSpecies = [
  "꽃게",
  "대게",
  "홍게",
  "킹크랩",
  "오징어",
  "갑오징어",
  "한치",
  "주꾸미",
  "낙지",
  "문어",
  "고등어",
  "갈치",
  "조기",
  "굴비",
  "민어",
  "병어",
  "삼치",
  "방어",
  "부시리",
  "참치",
  "광어",
  "우럭",
  "도다리",
  "가자미",
  "참돔",
  "감성돔",
  "돌돔",
  "농어",
  "숭어",
  "전어",
  "멸치",
  "꽁치",
  "청어",
  "대구",
  "명태",
  "아귀",
  "장어",
  "붕장어",
  "연어",
  "송어",
  "복어",
  "쥐치",
  "임연수",
  "볼락",
  "노래미",
  "새우",
  "대하",
  "흰다리새우",
  "랍스터",
  "전복",
  "소라",
  "굴",
  "바지락",
  "꼬막",
  "가리비",
  "홍합",
  "키조개",
  "해삼",
  "멍게",
  "개불",
  "성게",
  "미역",
  "김",
  "다시마",
];
const line = (max = 100) =>
  z
    .string()
    .trim()
    .min(1, "필수 항목을 입력해주세요.")
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), "한 줄로 입력해주세요.");
// 문자 인증 없이 직접 입력한 연락처에만 적용한다. 같은 숫자 반복·연속 숫자는 가짜 번호로 본다.
export function plausiblePhone(phone: string) {
  const subscriber = phone.slice(3);
  return (
    !/^(\d)\1+$/.test(subscriber) &&
    !"0123456789".includes(subscriber) &&
    !"9876543210".includes(subscriber)
  );
}
// 회원이 직접 추가하는 어종 이름. 쉼표·기호를 막아 여러 어종을 한 이름으로 넣지 못하게 한다.
export const speciesName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "어종 이름을 입력해주세요.")
      .max(30)
      .regex(
        /^[가-힣A-Za-z0-9 ]+$/,
        "어종 이름은 한글·영문·숫자만 쓸 수 있습니다. 여러 어종은 하나씩 추가해주세요.",
      )
      // 목록은 비로그인 화면에도 나오므로 전화번호 같은 긴 숫자는 받지 않는다.
      .refine((v) => !/\d{4,}/.test(v), "어종 이름을 확인해주세요."),
  );
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[-\s]/g, ""))
  // 010은 가운데 자리가 2~9로 시작하는 11자리만 발급된다.
  .pipe(
    z
      .string()
      .regex(
        /^(010[2-9]\d{7}|01[16789]\d{7,8})$/,
        "휴대폰 번호를 확인해주세요.",
      ),
  );
const price = z.coerce
  .number()
  .int()
  .min(1, "금액은 1원 이상이어야 합니다.")
  .max(1000000000);
const quantity = z.coerce.number().positive().max(100000000);
export const profileSchema = z.object({
  name: line(40),
  business: line(80),
  industry: line(40),
  region: line(60),
  market: z.string().trim().max(80).default(""),
  license: z.string().trim().max(40).default(""),
  bio: z.string().trim().max(1500).default(""),
  hours: line(80).default("06:00–18:00"),
  specialties: z.array(line(30)).max(30).default([]),
  procurement: z.boolean().default(false),
  contact: phoneSchema,
  interests: z
    .object({
      regions: z.array(line(60)).max(20),
      species: z.array(line(30)).max(30),
    })
    .default({ regions: [], species: [] }),
  digestHour: z.coerce.number().int().min(0).max(23).default(7),
  notifications: z.boolean().default(true),
});
export type Profile = z.infer<typeof profileSchema>;
export const signupSchema = z
  .object({
    role: z.enum(roles),
    profile: profileSchema,
    consent: z.literal(true),
  })
  .refine(
    (d) => d.role !== "broker" || !!(d.profile.market && d.profile.license),
    { message: "소속 위판장과 중매인 번호를 입력해주세요.", path: ["profile"] },
  );
export const listingSchema = z
  .object({
    species: line(30),
    state: z.enum(["선어", "활어", "냉동"]),
    grade: line(80),
    region: line(60),
    market: line(80),
    unit: z.enum(["kg", "상자", "마리"]),
    priceMin: price,
    priceMax: price,
    quantity,
    weightKg: z.number().positive().max(100000).nullable().default(null),
    minimum: quantity,
    pickup: line(160),
    pickupHours: line(100),
    note: z.string().trim().max(1500).default(""),
    photos: z
      .array(z.string().regex(/^\/media\/[0-9a-f-]+\.webp$/))
      .min(1, "사진을 한 장 이상 등록해주세요.")
      .max(5),
    confirmed: z.literal(true),
  })
  .refine((d) => d.priceMax >= d.priceMin, {
    message: "최대 금액은 최소 금액 이상이어야 합니다.",
    path: ["priceMax"],
  })
  .refine((d) => d.minimum <= d.quantity, {
    message: "최소 구매량은 판매 수량 이하여야 합니다.",
    path: ["minimum"],
  });
export type ListingData = z.infer<typeof listingSchema>;
export const requestSchema = z.object({
  species: line(30),
  grade: line(80),
  region: line(60),
  quantity,
  unit: z.enum(["kg", "상자", "마리"]),
  budget: price,
  receiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(1500).default(""),
});
export type RequestData = z.infer<typeof requestSchema>;
export interface User {
  id: string;
  phone: string | null;
  role: Role;
  profile: Profile;
  approval: "pending" | "approved" | "rejected";
  admin: boolean;
  suspended: boolean;
  created_at: string;
  demo: boolean;
}
export interface Listing {
  id: string;
  owner_id: string;
  data: ListingData;
  created_at: string;
  updated_at: string;
  expires_at: string;
  closed_at: string | null;
  hidden: boolean;
  demo: boolean;
  seller?: { name: string; business: string; hours: string; contact?: string };
}
export type PublicListing = Omit<Listing, "data"> & {
  data: Omit<ListingData, "priceMin" | "priceMax" | "pickup"> & {
    priceMin?: number;
    priceMax?: number;
    pickup?: string;
  };
};
export interface BuyRequest {
  id: string;
  owner_id: string;
  data: RequestData;
  created_at: string;
  closed_at: string | null;
  hidden: boolean;
  demo: boolean;
  business?: string;
  contact?: string;
}
export interface Notification {
  id: string;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
}
export interface MarketGroup {
  region: string;
  species: string;
  state: string;
  grade: string;
  unit: string;
  weightKg: number | null;
  priceMin: number;
  priceMax: number;
  quantity: number;
  count: number;
  brokers: number;
  demo: boolean;
}
export function kstDay(date: Date = new Date()) {
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function endOfDay(day = kstDay()) {
  return new Date(`${day}T23:59:59.999+09:00`).toISOString();
}
export function isOpen(
  item: Pick<Listing, "closed_at" | "expires_at" | "hidden">,
  now = new Date(),
) {
  return !item.closed_at && !item.hidden && new Date(item.expires_at) > now;
}
export function kgPrice(d: ListingData) {
  const divisor = d.unit === "kg" ? 1 : d.weightKg;
  return divisor ? Math.round(d.priceMin / divisor) : null;
}
export function publicListing(item: Listing, member: boolean): PublicListing {
  const { priceMin, priceMax, pickup, ...rest } = item.data;
  return {
    ...item,
    data: member ? { ...rest, priceMin, priceMax, pickup } : rest,
    seller: item.seller
      ? {
          ...item.seller,
          ...(!member || item.demo ? { contact: undefined } : {}),
        }
      : undefined,
  };
}
export function groupMarket(listings: Listing[]): MarketGroup[] {
  const groups = new Map<string, MarketGroup & { owners: Set<string> }>();
  for (const l of listings.filter((x) => !x.hidden)) {
    const d = l.data,
      key = JSON.stringify([
        d.region,
        d.species,
        d.state,
        d.grade,
        d.unit,
        d.weightKg,
        l.demo,
      ]);
    const g = groups.get(key) || {
      region: d.region,
      species: d.species,
      state: d.state,
      grade: d.grade,
      unit: d.unit,
      weightKg: d.weightKg,
      priceMin: d.priceMin,
      priceMax: d.priceMax,
      quantity: 0,
      count: 0,
      brokers: 0,
      demo: l.demo,
      owners: new Set<string>(),
    };
    g.priceMin = Math.min(g.priceMin, d.priceMin);
    g.priceMax = Math.max(g.priceMax, d.priceMax);
    g.quantity += d.quantity;
    g.count++;
    g.owners.add(l.owner_id);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ owners, ...g }) => ({
    ...g,
    quantity: Math.round(g.quantity * 1000) / 1000,
    brokers: owners.size,
  }));
}
export const money = (n: number) => new Intl.NumberFormat("ko-KR").format(n);
export const dateLabel = (s: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(s));
export function matchesInterests(
  region: string,
  species: string,
  interests: Profile["interests"],
) {
  return (
    (!interests.regions.length ||
      interests.regions.some((r) => region.includes(r))) &&
    (!interests.species.length || interests.species.includes(species))
  );
}
