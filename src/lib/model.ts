import { z } from "zod";
export const roles = ["broker", "buyer", "storage"] as const;
export type Role = (typeof roles)[number];
export const roleNames: Record<Role, string> = {
  broker: "중매인",
  buyer: "매입회원",
  storage: "보관업체",
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
  "오징어",
  "고등어",
  "갈치",
  "조기",
  "광어",
  "우럭",
  "대구",
  "새우",
  "문어",
  "낙지",
  "전복",
  "삼치",
  "가자미",
  "참돔",
];
const line = (max = 100) =>
  z
    .string()
    .trim()
    .min(1, "필수 항목을 입력해주세요.")
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), "한 줄로 입력해주세요.");
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[-\s]/g, ""))
  .pipe(z.string().regex(/^01[016789]\d{7,8}$/, "휴대폰 번호를 확인해주세요."));
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
export const storageSchema = z.object({
  name: line(80),
  region: line(60),
  address: line(160),
  kind: z.enum(["냉동", "냉장", "냉동·냉장"]),
  species: line(150),
  conditions: z.string().trim().min(1).max(1500),
  hours: line(80),
});
export type StorageData = z.infer<typeof storageSchema>;
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
export interface Warehouse {
  id: string;
  owner_id: string;
  data: StorageData;
  hidden: boolean;
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
