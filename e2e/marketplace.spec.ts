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
    "TRUNCATE members,otp_challenges,daily_snapshots,official_prices RESTART IDENTITY CASCADE",
  );
  await sql`INSERT INTO taxonomy(kind,name) VALUES('region','충남'),('region','부산'),('species','꽃게') ON CONFLICT DO NOTHING`;
});
test.afterAll(async () => {
  await sql.end();
});
test("approved broker uploads an image and publishes on mobile", async ({
  page,
  context,
}) => {
  await login(context, "01099008801", "broker");
  await sql`UPDATE members SET approval='approved' WHERE phone='01099008801'`;
  await page.goto("/listings/new");
  await page
    .getByLabel("상품 사진 추가")
    .setInputFiles("public/demo/market.jpg");
  await expect(page.locator(".photo-preview")).toHaveCount(1);
  await page.locator("input[name=species]").fill("꽃게");
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
test("anonymous HTML and API never contain prices or contact details", async ({
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
  await page.locator("input[name=species]").fill("꽃게");
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
test("storage member registers a facility and mobile navigation works", async ({
  page,
  context,
}) => {
  await login(context, "01099008803", "storage");
  await page.goto("/storage/new");
  await page.locator("input[name=address]").fill("테스트 전용 시설주소");
  await page.locator("input[name=species]").fill("선어, 냉동 수산물");
  await page
    .locator("textarea[name=conditions]")
    .fill("검증용 보관 조건 · 실제 운영 시설 아님");
  await page
    .getByRole("button", { name: "업체 소개 저장", exact: true })
    .click();
  await page.waitForURL("**/storage");
  await expect(page.locator(".warehouse-card")).toContainText(
    "테스트 전용 시설주소",
  );
  await page
    .getByRole("navigation", { name: "모바일 메뉴" })
    .getByRole("link", { name: "지역 시세" })
    .click();
  await expect(
    page.getByRole("heading", { name: "지역의 오늘을 읽는 가격 정보" }),
  ).toBeVisible();
  await expect(page.locator("table")).toContainText("31,001");
});
