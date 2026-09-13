import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import { makeAuctionNo } from "@/domain/auction/award";
import { quantityFromWeight } from "@/domain/settlement/calc";

const { tenants, users, memberships, platformAdmins, fishSpecies, vessels, rounds, intakes, auctions, bids, notifications } = schema;

const TZ_OFFSET = "+09:00";
function kst(dateStr: string, hhmm: string) { return new Date(`${dateStr}T${hhmm}:00${TZ_OFFSET}`); }
function todayKst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  await client`select set_config('app.bypass_rls', 'on', false)`;
  const pw = await bcrypt.hash("mansun1234", 10);

  const existing = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (existing.length) { console.log("이미 시드됨 — pnpm db:reset 으로 초기화 후 재실행"); await client.end(); return; }

  // ── 어종 마스터 (공유)
  const species = [
    ["mackerel", "고등어", "kg"], ["hairtail", "갈치", "box"], ["squid", "오징어", "ea"], ["flatfish", "광어", "kg"],
    ["red_seabream", "참돔", "kg"], ["yellowtail", "방어", "kg"], ["pollock", "명태", "box"], ["crab", "대게", "ea"],
    ["anchovy", "멸치", "box"], ["croaker", "조기", "box"], ["rockfish", "우럭", "kg"], ["octopus", "문어", "kg"],
  ] as const;
  await db.insert(fishSpecies).values(species.map(([code, name, unit], i) => ({ code, name, defaultUnit: unit, sortOrder: i })));

  // ── Tenants
  const feePolicy = { marketFeeRate: 0.04, brokerFeeRate: 0.015, vatIncluded: true, vatRate: 0.1 };
  const boxTable = { hairtail: { box: 20 }, pollock: { box: 15 }, anchovy: { box: 10 }, croaker: { box: 12 }, squid: { ea: 400 }, crab: { ea: 900 } };
  const schedule = [
    { seq: 1, label: "오전 1회차", bidStart: "06:30", bidClose: "07:00", autoNoticeAt: "05:00" },
    { seq: 2, label: "오전 2회차", bidStart: "08:30", bidClose: "09:00", autoNoticeAt: "07:30" },
  ];
  const [gangu] = await db.insert(tenants).values({
    code: "gangu", name: "강구항 수협", region: "경상북도", address: "경북 영덕군 강구면 강구항길 1", businessNo: "5058100001",
    status: "active", contactEmail: "ops@gangu.suhyup.kr", contactPhone: "0547330001",
    feePolicy, boxWeightTable: boxTable, schedule, reservePrices: { flatfish: 15000 },
    tieBreakPolicy: "first_come", digitalPriceVisibility: "hidden", bidModificationAllowed: true, fieldAuctionEnabled: true,
    pickupInstructions: "개찰 후 07:30까지 위판장 1구역에서 인수 · 문의 054-733-0001",
    activatedAt: new Date(),
  }).returning();
  const [pohang] = await db.insert(tenants).values({
    code: "pohang", name: "포항 수협", region: "경상북도", address: "경북 포항시 북구 죽도시장길 10", businessNo: "5068100002",
    status: "active", contactEmail: "ops@pohang.suhyup.kr", contactPhone: "0542400002",
    feePolicy: { marketFeeRate: 0.035, brokerFeeRate: 0.02, vatIncluded: true, vatRate: 0.1 }, boxWeightTable: { hairtail: { box: 18 } },
    schedule: [{ seq: 1, label: "새벽 1회차", bidStart: "05:30", bidClose: "06:00", autoNoticeAt: "04:30" }],
    tieBreakPolicy: "lottery", fieldAuctionEnabled: false, activatedAt: new Date(),
  }).returning();
  await db.insert(tenants).values({
    code: "tongyeong", name: "통영 수협", region: "경상남도", status: "pending", contactEmail: "ops@tongyeong.suhyup.kr",
    feePolicy, schedule: [],
  });

  // ── Users
  const mk = async (name: string, email: string, phone: string, extra: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db.insert(users).values({ name, email, phone, passwordHash: pw, identityVerified: true, ...extra }).returning();
    return u;
  };
  const platform = await mk("MANSUN 운영팀", "platform@mansun.kr", "01000000001");
  await db.insert(platformAdmins).values({ userId: platform.id });
  const ganguAdmin = await mk("정관리", "admin@gangu.kr", "01000000002");
  const op = await mk("김운영", "operator@gangu.kr", "01000000003");
  const recv = await mk("한입고", "receiver@gangu.kr", "01000000004");
  const brokerKim = await mk("김중매", "broker@gangu.kr", "01000000005");
  const brokerLee = await mk("이상철", "lee@gangu.kr", "01000000006");
  const brokerPark = await mk("박철수", "park@gangu.kr", "01000000007");
  const brokerChoi = await mk("최영수", "choi@gangu.kr", "01000000008");
  const shipParkSJ = await mk("박성진", "shipper1@gangu.kr", "01000000011", { bankAccount: "수협 101-1234-5678" });
  const shipLeeSC = await mk("이상철(선주)", "shipper2@gangu.kr", "01000000012", { bankAccount: "수협 101-2222-3333" });
  const shipChoiYS = await mk("최영수(선주)", "shipper3@gangu.kr", "01000000013", { bankAccount: "수협 101-4444-5555" });
  const shipKimYG = await mk("김영길", "shipper4@gangu.kr", "01000000014", { bankAccount: "수협 101-6666-7777" });
  const union = await mk("노조담당", "union@gangu.kr", "01000000021");
  const pohangAdmin = await mk("포항관리", "admin@pohang.kr", "01000000031");
  const pohangOp = await mk("이운영", "operator@pohang.kr", "01000000032");

  const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
  const soon = new Date(); soon.setDate(soon.getDate() + 5);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const m = (userId: string, tenantId: string, role: schema.Role, extra: Partial<typeof memberships.$inferInsert> = {}) =>
    ({ userId, tenantId, role, status: "active" as const, joinedAt: new Date(), ...extra });
  await db.insert(memberships).values([
    m(ganguAdmin.id, gangu.id, "admin", { title: "위판과장" }),
    m(op.id, gangu.id, "operator", { title: "위판팀" }),
    m(op.id, gangu.id, "receiver"),
    m(recv.id, gangu.id, "receiver"),
    m(brokerKim.id, gangu.id, "broker", { licenseNo: "M-201", licenseStatus: "active", licenseExpiresAt: d(nextYear) }),
    m(brokerLee.id, gangu.id, "broker", { licenseNo: "M-205", licenseStatus: "active", licenseExpiresAt: d(soon) }),
    m(brokerPark.id, gangu.id, "broker", { licenseNo: "M-218", licenseStatus: "active", licenseExpiresAt: d(nextYear) }),
    m(brokerChoi.id, gangu.id, "broker", { licenseNo: "M-302", licenseStatus: "active", licenseExpiresAt: d(nextYear) }),
    m(shipParkSJ.id, gangu.id, "shipper"), m(shipLeeSC.id, gangu.id, "shipper"), m(shipChoiYS.id, gangu.id, "shipper"), m(shipKimYG.id, gangu.id, "shipper"),
    m(union.id, gangu.id, "union", { squadCode: "1반" }),
    // 포항
    m(pohangAdmin.id, pohang.id, "admin"), m(pohangOp.id, pohang.id, "operator"), m(pohangOp.id, pohang.id, "receiver"),
    m(brokerKim.id, pohang.id, "broker", { licenseNo: "B-340", licenseStatus: "active", licenseExpiresAt: d(nextYear) }),
    m(shipParkSJ.id, pohang.id, "shipper"),
  ]);

  // ── 선박
  const vRows = await db.insert(vessels).values([
    { tenantId: gangu.id, name: "제3만선호", registrationNo: "GG-0301", shipperUserId: shipParkSJ.id },
    { tenantId: gangu.id, name: "동해호", registrationNo: "GG-0117", shipperUserId: shipLeeSC.id },
    { tenantId: gangu.id, name: "백호1호", registrationNo: "GG-0208", shipperUserId: shipChoiYS.id },
    { tenantId: gangu.id, name: "해랑호", registrationNo: "GG-0412", shipperUserId: shipKimYG.id },
    { tenantId: pohang.id, name: "포항1호", registrationNo: "PH-0001", shipperUserId: shipParkSJ.id },
  ]).returning();
  const V = Object.fromEntries(vRows.map((v) => [v.name, v]));

  // ── 오늘 회차 (강구) — 시연을 위해 입찰 마감을 현재 시각 + 40분으로
  const today = todayKst();
  const now = new Date();
  const bidStart = new Date(now.getTime() - 10 * 60 * 1000);
  const bidClose = new Date(now.getTime() + 40 * 60 * 1000);
  const fieldStart = new Date(bidClose.getTime() + 5 * 60 * 1000);
  const [round1] = await db.insert(rounds).values({
    tenantId: gangu.id, date: today, seq: 1, label: `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} 오전 1회차`,
    bidStartAt: bidStart, bidCloseAt: bidClose, fieldStartAt: fieldStart, status: "in_progress",
  }).returning();
  await db.insert(rounds).values({
    tenantId: gangu.id, date: today, seq: 2, label: `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} 오전 2회차`,
    bidStartAt: new Date(now.getTime() + 2 * 3600_000), bidCloseAt: new Date(now.getTime() + 3 * 3600_000), fieldStartAt: new Date(now.getTime() + 3 * 3600_000 + 5 * 60_000), status: "scheduled",
  });

  // ── 입고 + 경매 물품 (mockup 14건)
  type Lot = [tank: string, species: string, weight: number, unit: schema.BidUnit, qty: number | null, grade: schema.Grade, note: string];
  const intakeDefs: { vessel: string; arrived: string; lots: Lot[] }[] = [
    { vessel: "제3만선호", arrived: "04:20", lots: [["T-01", "mackerel", 320, "kg", null, "A", "활어, 선도 우수"], ["T-02", "hairtail", 220, "box", 11, "A", "20kg 박스 × 11"], ["T-03", "squid", 280, "ea", 540, "B", "선어"]] },
    { vessel: "동해호", arrived: "04:55", lots: [["T-04", "flatfish", 230, "kg", null, "A", "활어"], ["T-05", "red_seabream", 180, "kg", null, "A", "활어"], ["T-06", "yellowtail", 95, "kg", null, "A", "대방어"], ["T-07", "mackerel", 35, "kg", null, "B", ""]] },
    { vessel: "백호1호", arrived: "05:10", lots: [["T-08", "pollock", 300, "box", 20, "A", "냉동"], ["T-09", "crab", 180, "ea", 200, "A", "활게"], ["T-10", "rockfish", 140, "kg", null, "B", "활어"], ["T-11", "octopus", 60, "kg", null, "A", "활문어"]] },
    { vessel: "해랑호", arrived: "05:40", lots: [["T-12", "anchovy", 200, "box", 20, "B", "건멸치"], ["T-13", "croaker", 120, "box", 10, "A", ""], ["T-14", "mackerel", 60, "kg", null, "C", "소형"]] },
  ];
  let seq = 0;
  const lotIds: Record<string, string> = {};
  for (const def of intakeDefs) {
    const [it] = await db.insert(intakes).values({
      tenantId: gangu.id, vesselId: V[def.vessel].id, roundId: round1.id, arrivedAt: kst(today, def.arrived),
      status: "announced", createdBy: recv.id, confirmedAt: kst(today, def.arrived), confirmedBy: op.id,
    }).returning();
    for (const [tank, sp, weight, unit, qty, grade, note] of def.lots) {
      seq += 1;
      const quantity = quantityFromWeight(weight, unit, sp, boxTable, qty);
      const [a] = await db.insert(auctions).values({
        tenantId: gangu.id, intakeId: it.id, roundId: round1.id, auctionNo: makeAuctionNo("gangu", today, 1, seq), tankNo: tank,
        speciesCode: sp, weightKg: weight, unit, quantity, grade, note: note || null, status: "open",
        reservePrice: sp === "flatfish" ? 15000 : null,
      }).returning();
      lotIds[tank] = a.id;
    }
  }

  // ── 일부 입찰 (밀봉) — 김중매/박철수/최영수
  const mem = async (userId: string) => (await db.select({ id: memberships.id }).from(memberships).where(sql`${memberships.userId} = ${userId} and ${memberships.tenantId} = ${gangu.id} and ${memberships.role} = 'broker'`))[0].id;
  const mKim = await mem(brokerKim.id), mPark = await mem(brokerPark.id), mChoi = await mem(brokerChoi.id), mLee = await mem(brokerLee.id);
  const bidDefs: [tank: string, m: string, uid: string, price: number, minsAgo: number][] = [
    ["T-01", mKim, brokerKim.id, 8200, 8], ["T-01", mPark, brokerPark.id, 7900, 6], ["T-01", mChoi, brokerChoi.id, 8200, 5],
    ["T-02", mKim, brokerKim.id, 48000, 7], ["T-02", mLee, brokerLee.id, 46000, 4],
    ["T-03", mPark, brokerPark.id, 1800, 7],
    ["T-04", mLee, brokerLee.id, 22500, 6], ["T-04", mKim, brokerKim.id, 22000, 3],
    ["T-05", mKim, brokerKim.id, 31000, 5],
    ["T-06", mKim, brokerKim.id, 14800, 4], ["T-06", mChoi, brokerChoi.id, 14500, 2],
    ["T-08", mPark, brokerPark.id, 42000, 3],
  ];
  const counts: Record<string, number> = {};
  for (const [tank, mId, uid, price, ago] of bidDefs) {
    const at = new Date(now.getTime() - ago * 60 * 1000);
    await db.insert(bids).values({ tenantId: gangu.id, auctionId: lotIds[tank], brokerMembershipId: mId, brokerUserId: uid, price, submittedAt: at, firstSubmittedAt: at, ip: "seed" });
    counts[tank] = (counts[tank] ?? 0) + 1;
  }
  for (const [tank, c] of Object.entries(counts)) await db.update(auctions).set({ bidCount: c }).where(eq(auctions.id, lotIds[tank]));

  // ── 알림 예시
  await db.insert(notifications).values([
    { userId: brokerKim.id, tenantId: gangu.id, type: "notice", title: `[강구항] ${round1.label} 경매 공지`, body: "입찰 마감 전 참여하세요. 14개 품목", link: `/t/gangu/broker/auctions` },
    { userId: brokerKim.id, tenantId: pohang.id, type: "system", title: "[포항] 면허 등록 완료", body: "B-340 면허가 활성화되었습니다", link: `/t/pohang/broker/my` },
    { userId: op.id, tenantId: gangu.id, type: "intake_new", title: "새 입고: 해랑호", body: "3개 품목 380kg", link: `/t/gangu/operator/intake` },
  ]);

  console.log("seed complete");
  console.log("공통 비밀번호: mansun1234");
  console.log("platform@mansun.kr (Platform Admin) / admin@gangu.kr / operator@gangu.kr / receiver@gangu.kr / broker@gangu.kr(강구+포항) / shipper1@gangu.kr / union@gangu.kr / admin@pohang.kr");
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
