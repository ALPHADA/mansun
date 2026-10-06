import { test, expect, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
const sql = postgres("postgres://localhost:5432/mansun_market_e2e_test", {
  onnotice: () => {},
});
const token = randomUUID();
const nickname = "검증회원_" + token.slice(0, 8);
let ownerId: string;
test.beforeAll(async () => {
  await sql.unsafe(await readFile("scripts/schema.sql", "utf8"));
  const [owner] =
    await sql`INSERT INTO members(phone,role,profile) VALUES(NULL,'buyer',${sql.json({ name: "BOARD_PRIVATE_NAME", business: "BOARD_PRIVATE_BUSINESS", contact: "01098764321", region: "부산", interests: { regions: [], species: [] } })}) RETURNING id`;
  ownerId = owner.id;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${createHash("sha256").update(token).digest("hex")},${ownerId},now()+interval '1 hour')`;
});
test.afterAll(async () => {
  try {
    if (ownerId) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM board_comments WHERE author_id=${ownerId}`;
        await tx`DELETE FROM board_posts WHERE author_id=${ownerId}`;
        await tx`DELETE FROM sessions WHERE user_id=${ownerId}`;
        await tx`DELETE FROM activity WHERE user_id=${ownerId}`;
        await tx`DELETE FROM members WHERE id=${ownerId}`;
      });
    }
  } finally {
    await sql.end();
  }
});
const signIn = (context: BrowserContext) =>
  context.addCookies([
    {
      name: "mansun_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
test("public text board supports nickname setup, safe rendering, comments and owner edits", async ({
  page,
  context,
  request,
}) => {
  const anonymousWrite = await request.post("/api/v1/board/posts", {
    headers: { origin: "http://localhost:3006" },
    data: { title: "무단 글", body: "본문" },
  });
  expect(anonymousWrite.status()).toBe(401);
  await page.goto("/board/new");
  await expect(page.getByText("로그인하고 글을 작성하세요")).toBeVisible();
  await signIn(context);
  await page.reload();
  await page.getByLabel("별명", { exact: true }).fill(nickname);
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByLabel("제목", { exact: true })).toBeVisible();
  await page.getByLabel("제목", { exact: true }).fill("공개 게시판 테스트");
  await page
    .getByLabel("내용", { exact: true })
    .fill("<script>window.BOARD_XSS=true</script>\n글 내용");
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await page.waitForURL(/\/board\/[0-9a-f-]+$/);
  const id = page.url().split("/").pop()!;
  expect(await page.evaluate(() => "BOARD_XSS" in window)).toBe(false);
  await page.getByLabel("댓글 쓰기", { exact: true }).fill("댓글 테스트");
  await page.getByRole("button", { name: "댓글 등록", exact: true }).click();
  await expect(page.locator(".board-comments article")).toContainText(
    "댓글 테스트",
  );
  await expect(page.getByLabel("댓글 쓰기", { exact: true })).toHaveValue("");
  await page.getByRole("link", { name: "수정", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("수정한 게시글");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "수정한 게시글", exact: true }),
  ).toBeVisible();
  const res = await request.get(`/api/v1/board/posts/${id}`);
  expect(res.status()).toBe(200);
  const payload = await res.text();
  expect(payload).toContain(nickname);
  for (const secret of [
    "BOARD_PRIVATE_NAME",
    "BOARD_PRIVATE_BUSINESS",
    "01098764321",
    ownerId,
  ])
    expect(payload).not.toContain(secret);
  await context.clearCookies();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "수정한 게시글" }),
  ).toBeVisible();
  await expect(page.getByText("로그인하고 댓글을 작성하세요")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.goto("/board?q=수정한");
  await expect(page.locator(".board-list")).toContainText("수정한 게시글");
  const nav = page.getByRole("navigation", { name: "모바일 메뉴" });
  await expect(
    nav.getByRole("link", { name: "자유게시판", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "매입 요청", exact: true }),
  ).toHaveCount(0);
});
