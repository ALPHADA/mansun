import { test, expect, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
const sql = postgres("postgres://localhost:5432/mansun_market_e2e_test", {
  onnotice: () => {},
});
let listingId = "";
async function login(context: BrowserContext, phone: string, role = "buyer") {
  const req = await context.request.post("/api/v1/auth/request", {
    headers: { origin: "http://localhost:3006" },
    data: { phone },
  });
  expect(req.status()).toBe(200);
  const c = await req.json();
  const verify = await context.request.post("/api/v1/auth/verify", {
    headers: { origin: "http://localhost:3006" },
    data: {
      challengeId: c.challengeId,
      code: c.developmentCode,
      signup: {
        role,
        consent: true,
        profile: {
          name: "현장테스트",
          business: "검증수산",
          industry: "수산물",
          region: "충남 태안",
          market: "신진도",
          license: "123",
          contact: phone,
        },
      },
    },
  });
  expect(verify.status()).toBe(200);
}
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await sql.unsafe(await readFile("scripts/schema.sql", "utf8"));
  await sql.unsafe(
    "TRUNCATE members,otp_challenges,daily_snapshots,official_prices,official_observations,official_sync_runs RESTART IDENTITY CASCADE",
  );
  await sql`DELETE FROM taxonomy WHERE name LIKE '테스트%'`;
  await sql`INSERT INTO taxonomy(kind,name) VALUES('region','충남'),('region','부산'),('species','꽃게') ON CONFLICT DO NOTHING`;
});
test.afterAll(async () => {
  await sql.end();
});
test("broker uploads an image and publishes right after signup on mobile", async ({
  page,
  context,
}) => {
  await login(context, "01099008801", "broker");
  await page.goto("/listings/new");
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("상품 사진 추가")
    .setInputFiles("public/demo/market.jpg");
  await expect(page.locator(".photo-preview")).toHaveCount(1);
  await page.locator("select[name=species]").selectOption("꽃게");
  await page.locator("input[name=grade]").fill("대 3~4미");
  await page.locator("input[name=priceMin]").fill("31001");
  await page.locator("input[name=priceMax]").fill("35001");
  await page.locator("input[name=quantity]").fill("20");
  await page.locator("input[name=pickup]").fill("PRIVATE_PICKUP_E2E");
  await page.locator("input[name=pickupHours]").fill("07:00–12:00");
  await page.locator("input[name=confirmed]").check();
  await page
    .getByRole("button", { name: "물건 등록하기", exact: true })
    .click();
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}$/);
  listingId = page.url().split("/").pop()!;
  await expect(page.locator(".detail-price")).toContainText("31,001");
  await expect(page.getByText("PRIVATE_PICKUP_E2E")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
});
test("anonymous listing HTML and API never contain broker prices or contact details", async ({
  page,
  request,
}) => {
  await page.goto("/listings/" + listingId);
  await expect(
    page.getByText("로그인하고 가격과 연락처를 확인하세요"),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("31001");
  expect(html).not.toContain("PRIVATE_PICKUP_E2E");
  expect(html).not.toContain("01099008801");
  const res = await request.get("/api/v1/listings/" + listingId);
  const body = await res.text();
  expect(body).not.toContain("31001");
  expect(body).not.toContain("PRIVATE_PICKUP_E2E");
});
test("buyer sees price, saves a product and posts a buying request", async ({
  page,
  context,
}) => {
  await login(context, "01099008802");
  await page.goto("/listings/" + listingId);
  await expect(page.locator(".detail-price")).toContainText("31,001");
  await page
    .getByRole("button", { name: "관심 상품 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "관심 상품 해제", exact: true }),
  ).toBeVisible();
  await page.goto("/requests/new");
  await page.locator("select[name=species]").selectOption("꽃게");
  await page.locator("input[name=grade]").fill("대");
  await page.locator("input[name=quantity]").fill("30");
  await page.locator("input[name=budget]").fill("1000000");
  await page.locator("input[name=receiveDate]").fill("2027-12-31");
  await page
    .getByRole("button", { name: "매입 요청 올리기", exact: true })
    .click();
  await page.waitForURL("**/requests");
  await expect(page.locator(".request-card")).toContainText("1,000,000");
  await page.goto("/me?tab=saved");
  await expect(page.locator(".product")).toHaveCount(1);
});
test("storage routes are removed and mobile navigation works", async ({
  page,
  context,
}) => {
  await login(context, "01099008803", "buyer");
  for (const path of ["/storage", "/storage/new", "/api/v1/storage"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
  const response = await context.request.post("/api/v1/storage", {
    headers: { origin: "http://localhost:3006" },
    data: {},
  });
  expect(response.status()).toBe(404);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "보관업체", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle("전국 수산물 경매 정보방");
  await expect(page.locator("header .brand")).toContainText(
    "전국 수산물 경매 정보방",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("navigation", { name: "모바일 메뉴" })
    .getByRole("link", { name: "지역 시세" })
    .click();
  await expect(
    page.getByRole("heading", { name: "전국 수산물 가격 정보" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "중매인 판매가", exact: true }).click();
  await expect(page.locator("table").first()).toContainText("31,001");
});

test("official prices are public while broker prices stay private on narrow screens", async ({
  page,
}) => {
  const data = {
    key: "official-e2e",
    day: "2026-01-02",
    region: "부산",
    market: "검증위판장",
    species: "검증고등어",
    state: "선어",
    grade: "대",
    unit: "상자",
    kind: "auction",
    low: 827341,
    high: 827399,
    previous: null,
    week: null,
  };
  await sql`INSERT INTO official_observations(provider,basis_day,item_key,region,species,market,data) VALUES('mof','2026-01-02','official-e2e','부산','검증고등어','검증위판장',${sql.json(data)})`;
  await page.goto("/market?day=2026-01-02&q=&q=꽃게");
  await expect(page.locator(".official-price-table")).toContainText("827,341");
  await expect(page.locator(".official-price-table")).toContainText(
    "검증고등어",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/market?day=2026-01-02&region=부산");
  await expect(page.locator(".official-price-table")).toContainText("827,341");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.goto("/market?day=2026-01-03&region=부산");
  await page
    .getByRole("link", { name: "최근 자료 보기 · 2026-01-02 →" })
    .click();
  await expect(page.locator(".official-price-table")).toContainText(
    "검증고등어",
  );
  const kamisData = {
    ...data,
    key: "kamis-public-e2e",
    kind: "retail",
    low: 12345,
    high: 12345,
    region: "전국",
  };
  await sql`INSERT INTO official_observations(provider,basis_day,item_key,region,species,market,data) VALUES('kamis','2026-01-02','kamis-public-e2e','전국','검증고등어','전국 조사 평균',${sql.json(kamisData)})`;
  await page.getByRole("link", { name: "도·소매 참고", exact: true }).click();
  await expect(page.locator(".official-price-table")).toContainText("12,345");
  await expect(
    page.getByText(
      "전국 조사 평균 · 경매 낙찰가와 다른 도매·소매 판매가격입니다.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "중매인 판매가", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "중매인 등록 판매가" }),
  ).toBeVisible();
  await page.goto("/market?tab=broker");
  await expect(page.locator(".login-gate")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  expect(await page.content()).not.toContain("31,001");
  expect(await page.content()).not.toContain("31001");
});

test("tablet navigation stays inside the header above the content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
  await expect(page.locator(".market-search")).toBeVisible();
  const bounds = await page.evaluate(() => ({
    header: document.querySelector("header")!.getBoundingClientRect().bottom,
    nav: document.querySelector(".desktop-nav")!.getBoundingClientRect().bottom,
    content: document.querySelector("main")!.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(bounds.nav).toBeLessThanOrEqual(bounds.header);
  expect(bounds.content).toBeGreaterThanOrEqual(bounds.header);
  expect(bounds.overflow).toBe(false);
});

test("tablet footer remains readable above the fixed navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await expect(page.locator(".market-search")).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await page.locator("footer small").scrollIntoViewIfNeeded();
  const footer = await page.locator("footer small").boundingBox();
  const nav = await page.locator(".mobile-nav").boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(nav!.y);
});
