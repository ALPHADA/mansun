import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const cookieStore = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      cookieStore.has(k) ? { value: cookieStore.get(k) } : undefined,
    set: (k: string, v: string) => cookieStore.set(k, v),
    delete: (k: string) => cookieStore.delete(k),
  }),
}));
import { db } from "../src/server/db";
import { mutate } from "../src/server/mutations";
import { listing, market, requests } from "../src/server/queries";
import { requestOtp, verifyOtp, currentUser, devSms } from "../src/server/auth";
import { runJobs } from "../src/server/jobs";
import {
  profileSchema,
  kstDay,
  type User,
  type ListingData,
} from "../src/lib/model";
import { POST, GET } from "../src/app/api/v1/[...path]/route";
let broker: User, buyer: User, admin: User, other: User;
let listingId = "";
const image = randomUUID() + ".webp";
const phone = "01099009901";
const data: ListingData = {
  species: "테스트꽃게",
  state: "선어",
  grade: "대",
  region: "충남 태안",
  market: "테스트위판장",
  unit: "상자",
  priceMin: 33001,
  priceMax: 43001,
  quantity: 20,
  minimum: 1,
  weightKg: 10,
  pickup: "PRIVATE_PICKUP_ADDRESS",
  pickupHours: "07:00–12:00",
  photos: ["/media/" + image],
  confirmed: true,
  note: "",
};
beforeAll(async () => {
  const sql = db();
  await sql.unsafe(await readFile("scripts/schema.sql", "utf8"));
  await sql.unsafe(
    "TRUNCATE members,otp_challenges,daily_snapshots,official_prices RESTART IDENTITY CASCADE",
  );
  const members = [];
  for (let i = 0; i < 4; i++) {
    const profile = profileSchema.parse({
      name: "테스트" + i,
      business: "테스트수산" + i,
      industry: "수산물",
      region: "충남 태안",
      market: "테스트위판장",
      license: "1",
      contact: "0109900990" + i,
      interests: { regions: ["충남"], species: ["테스트꽃게"] },
      digestHour: 0,
    });
    const [u] = await sql<
      User[]
    >`INSERT INTO members(phone,role,profile,approval,admin) VALUES(${"0109900990" + i},${i === 1 ? "buyer" : "broker"},${sql.json(profile)},${"approved"},${i === 2}) RETURNING *`;
    members.push(u);
  }
  [broker, buyer, admin, other] = members;
  await sql`INSERT INTO assets(id,owner_id) VALUES(${image},${broker.id})`;
  const stranger = profileSchema.parse({
    ...other.profile,
    interests: { regions: ["부산"], species: [] },
  });
  await sql`UPDATE members SET profile=${sql.json(stranger)} WHERE id=${other.id}`;
});
afterAll(async () => {
  await db().end();
});
it("rejects publication by non-brokers", async () => {
  await expect(mutate(buyer, "listings", data)).rejects.toMatchObject({
    status: 403,
  });
});
it("publishes, protects API data, and keeps price history", async () => {
  const result = (await mutate(broker, "listings", data)) as { id: string };
  listingId = result.id;
  const publicData = JSON.stringify(await listing(listingId, null));
  expect(publicData).not.toContain("33001");
  expect(publicData).not.toContain("43001");
  expect(publicData).not.toContain("PRIVATE_PICKUP_ADDRESS");
  expect(publicData).not.toContain(broker.phone);
  expect((await listing(listingId, buyer))?.data.priceMin).toBe(33001);
  const route = await GET(
    new Request("http://localhost:3005/api/v1/listings/" + listingId),
    { params: Promise.resolve({ path: ["listings", listingId] }) },
  );
  expect(await route.text()).not.toContain("33001");
  await mutate(broker, "listings", { ...data, id: listingId, priceMin: 34001 });
  const [h] =
    await db()`SELECT count(*)::int AS n FROM price_history WHERE listing_id=${listingId}`;
  expect(h.n).toBe(2);
});
it("rejects ownership violations and other users images", async () => {
  await expect(
    mutate(admin, "listings", { ...data, id: listingId }),
  ).rejects.toBeTruthy();
  await expect(
    mutate(buyer, "listings/close", { id: listingId }),
  ).rejects.toMatchObject({ status: 403 });
});
it("creates buying requests only for buyers and protects anonymous access", async () => {
  const d = {
    species: "테스트꽃게",
    grade: "대",
    region: "충남 태안",
    quantity: 10,
    unit: "kg",
    budget: 50000,
    receiveDate: kstDay(),
    deadline: kstDay(),
    note: "",
  };
  await expect(mutate(broker, "requests", d)).rejects.toMatchObject({
    status: 403,
  });
  await mutate(buyer, "requests", d);
  expect(await requests(null)).toHaveLength(0);
  expect((await requests(broker)).length).toBe(1);
});
it("generates one digest per member per day and respects interests", async () => {
  await runJobs();
  await runJobs();
  const [n] =
    await db()`SELECT count(*)::int AS n FROM notifications WHERE user_id=${buyer.id} AND dedupe IS NOT NULL`;
  expect(n.n).toBe(1);
  const strangerProfile = profileSchema.parse({
    ...buyer.profile,
    interests: { regions: ["부산"], species: [] },
  });
  await db()`UPDATE members SET profile=${db().json(strangerProfile)} WHERE id=${other.id}`;
  await runJobs();
  const [no] =
    await db()`SELECT count(*)::int AS n FROM notifications WHERE user_id=${other.id} AND dedupe IS NOT NULL`;
  expect(no.n).toBe(0);
});
it("blocks admin access, hides content and excludes it from statistics", async () => {
  await expect(
    mutate(buyer, "admin/content", {
      kind: "listing",
      id: listingId,
      hidden: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await mutate(admin, "admin/content", {
    kind: "listing",
    id: listingId,
    hidden: true,
  });
  expect(await listing(listingId, buyer)).toBe(null);
  expect((await market(kstDay())).groups).toHaveLength(0);
  const [log] =
    await db()`SELECT actor_id FROM audit_log WHERE action='admin/content' ORDER BY id DESC LIMIT 1`;
  expect(log.actor_id).toBe(admin.id);
  await mutate(admin, "admin/content", {
    kind: "listing",
    id: listingId,
    hidden: false,
  });
});
it("closing is enforced and copied listing requires fresh confirmation", async () => {
  await mutate(broker, "listings/close", { id: listingId });
  await expect(
    mutate(broker, "listings", { ...data, id: listingId }),
  ).rejects.toBeTruthy();
  await expect(
    mutate(broker, "listings", { ...data, confirmed: false }),
  ).rejects.toBeTruthy();
});
it("prevents cross-site mutations", async () => {
  const res = await POST(
    new Request("http://localhost:3005/api/v1/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    { params: Promise.resolve({ path: ["auth", "logout"] }) },
  );
  expect(res.status).toBe(403);
});
it("limits OTP retries, commits failures and prevents reuse", async () => {
  vi.stubEnv("DEV_SMS_PREVIEW", "true");
  const req = new Request("http://localhost:3005/api/v1/auth/request", {
    headers: { origin: "http://localhost:3005" },
  });
  const challenge = await requestOtp(phone, req);
  await expect(requestOtp(phone, req)).rejects.toMatchObject({ status: 429 });
  await expect(
    verifyOtp({ challengeId: challenge.challengeId, code: "000000" }),
  ).rejects.toBeTruthy();
  const [row] =
    await db()`SELECT attempts FROM otp_challenges WHERE id=${challenge.challengeId}`;
  expect(row.attempts).toBe(1);
  await verifyOtp({
    challengeId: challenge.challengeId,
    code: challenge.developmentCode!,
  });
  expect((await currentUser())?.id).toBe(buyer.id);
  await expect(
    verifyOtp({
      challengeId: challenge.challengeId,
      code: challenge.developmentCode!,
    }),
  ).rejects.toBeTruthy();
  cookieStore.clear();
});
it("SMS-verified signup wins over a self-entered contact and flags the other account", async () => {
  vi.stubEnv("DEV_SMS_PREVIEW", "true");
  const number = "01099009977";
  const [squatter] =
    await db()`INSERT INTO members(phone,role,profile,approval) VALUES(NULL,'buyer',${db().json({ ...buyer.profile, contact: number })},'approved') RETURNING id`;
  const req = new Request("http://localhost:3005/api/v1/auth/request", {
    headers: { origin: "http://localhost:3005" },
  });
  const challenge = await requestOtp(number, req);
  await verifyOtp({
    challengeId: challenge.challengeId,
    code: challenge.developmentCode!,
    signup: {
      role: "broker",
      profile: { ...broker.profile, contact: number },
      consent: true,
    },
  });
  const user = await currentUser();
  expect(user?.phone).toBe(number);
  expect(user?.approval).toBe("approved");
  const [flag] =
    await db()`SELECT count(*)::int AS n FROM audit_log WHERE action='contact.conflict' AND target=${number} AND detail->>'member'=${squatter.id}`;
  expect(flag.n).toBe(1);
  const [note] =
    await db()`SELECT count(*)::int AS n FROM notifications WHERE user_id=${squatter.id} AND title='연락처를 확인해주세요'`;
  expect(note.n).toBe(1);
  cookieStore.clear();
});
it("never exposes development OTP on public host or production", () => {
  vi.stubEnv("DEV_SMS_PREVIEW", "true");
  expect(
    devSms(
      new Request("https://public.example/api", {
        headers: { origin: "https://public.example" },
      }),
    ),
  ).toBe(false);
  vi.stubEnv("NODE_ENV", "production");
  expect(
    devSms(
      new Request("http://localhost:3005/api", {
        headers: { origin: "http://localhost:3005" },
      }),
    ),
  ).toBe(false);
  vi.unstubAllEnvs();
});

it("keeps official prices separate with an unambiguous date", async () => {
  await mutate(admin, "admin/official", {
    sourceName: "검증 출처",
    sourceUrl: "https://www.data.go.kr/data/15012300/fileData.do",
    day: kstDay(),
    region: "충남 태안",
    species: "테스트꽃게",
    state: "선어",
    grade: "대",
    unit: "상자",
    priceMin: 10000,
    priceMax: 12000,
    verified: true,
  });
  const report = await market(kstDay());
  expect(report.official).toHaveLength(1);
  expect(report.official[0].basis_day).toBe(kstDay());
  expect(report.groups[0].priceMin).toBe(34001);
});

it("Kakao rejects forged state and consumes OAuth attempts once", async () => {
  const { startKakao, finishKakao } = await import("../src/server/kakao");
  process.env.KAKAO_REST_API_KEY = "test-key";
  process.env.KAKAO_CLIENT_SECRET = "test-secret";
  const url = new URL(await startKakao("//evil.example"));
  expect(url.hostname).toBe("kauth.kakao.com");
  expect(url.searchParams.has("scope")).toBe(false);
  const state = url.searchParams.get("state")!;
  await expect(
    finishKakao(new URLSearchParams({ state: "forged", code: "test" })),
  ).rejects.toThrow();
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ access_token: "private-token" }))
    .mockResolvedValueOnce(Response.json({ id: 87654321 }));
  expect(await finishKakao(new URLSearchParams({ state, code: "test" }))).toBe(
    "/signup/kakao",
  );
  expect(mock).toHaveBeenCalledTimes(2);
  expect(String(mock.mock.calls[0][1]?.body)).toContain(
    "client_secret=test-secret",
  );
  cookieStore.set("mansun_kakao_state", state);
  await expect(
    finishKakao(new URLSearchParams({ state, code: "test" })),
  ).rejects.toThrow();
  expect(mock).toHaveBeenCalledTimes(2);
  mock.mockRestore();
});
it("Kakao signup rejects a contact another member uses, then approves a broker immediately and cannot replay", async () => {
  const { completeKakaoSignup } = await import("../src/server/kakao");
  await expect(
    completeKakaoSignup({
      role: "broker",
      profile: broker.profile,
      consent: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await completeKakaoSignup({
    role: "broker",
    profile: { ...broker.profile, contact: "01099009955" },
    consent: true,
  });
  const user = await currentUser();
  expect(user?.id).not.toBe(broker.id);
  expect(user?.phone).toBeNull();
  expect(user?.approval).toBe("approved");
  expect(user?.admin).toBe(false);
  expect(user?.profile.contact).toBe("01099009955");
  await expect(
    mutate(user!, "profile", { ...user!.profile, contact: buyer.phone }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutate(user!, "profile", { ...user!.profile, contact: "01055555555" }),
  ).rejects.toMatchObject({ status: 400 });
  // 자기 연락처 그대로 저장, 비어 있는 번호로 변경은 허용된다.
  await mutate(user!, "profile", user!.profile);
  await mutate(user!, "profile", { ...user!.profile, contact: "01099009956" });
  expect((await currentUser())?.profile.contact).toBe("01099009956");
  // 선점 계정을 정지하면 실제 주인이 그 번호를 쓸 수 있고, 그 뒤에는 정지를 해제할 수 없다.
  const [squatter] =
    await db()`INSERT INTO members(phone,role,profile,approval) VALUES(NULL,'buyer',${db().json({ ...buyer.profile, contact: "01099009957" })},'approved') RETURNING id`;
  await expect(
    mutate(user!, "profile", { ...user!.profile, contact: "01099009957" }),
  ).rejects.toMatchObject({ status: 409 });
  await mutate(admin, "admin/member", { id: squatter.id, suspended: true });
  await mutate(user!, "profile", { ...user!.profile, contact: "01099009957" });
  await expect(
    mutate(admin, "admin/member", { id: squatter.id, suspended: false }),
  ).rejects.toMatchObject({ status: 409 });
  // 운영자가 approval을 보내도 무시되고, 위판장·중매인 번호가 없는 중매인은 등록할 수 없다.
  await mutate(admin, "admin/member", { id: user!.id, approval: "rejected" });
  expect((await currentUser())?.approval).toBe("approved");
  await expect(
    mutate(
      { ...user!, profile: { ...user!.profile, market: "", license: "" } },
      "listings",
      data,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    completeKakaoSignup({
      role: "buyer",
      profile: buyer.profile,
      consent: true,
    }),
  ).rejects.toMatchObject({ status: 401 });
});
it("Kakao existing account logs in without duplicate signup and rejects suspension", async () => {
  const { startKakao, finishKakao } = await import("../src/server/kakao");
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      Response.json(
        String(url).includes("oauth/token")
          ? { access_token: "private-token" }
          : { id: 87654321 },
      ),
    );
  let url = new URL(await startKakao("/market"));
  expect(
    await finishKakao(
      new URLSearchParams({
        state: url.searchParams.get("state")!,
        code: "ok",
      }),
    ),
  ).toBe("/market");
  const user = await currentUser();
  await db()`UPDATE members SET suspended=true WHERE id=${user!.id}`;
  url = new URL(await startKakao("/"));
  await expect(
    finishKakao(
      new URLSearchParams({
        state: url.searchParams.get("state")!,
        code: "ok",
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  mock.mockRestore();
  delete process.env.KAKAO_REST_API_KEY;
  delete process.env.KAKAO_CLIENT_SECRET;
});
