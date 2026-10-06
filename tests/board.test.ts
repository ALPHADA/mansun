import { adminData } from "../src/server/queries";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { profileSchema, type User } from "../src/lib/model";
import { mutate } from "../src/server/mutations";
import {
  boardList,
  boardPost,
  boardComments,
  boardSettings,
} from "../src/server/board";
let owner: User, other: User, admin: User;
beforeAll(async () => {
  await db().unsafe(await readFile("scripts/schema.sql", "utf8"));
});
beforeEach(async () => {
  await db().unsafe("TRUNCATE members CASCADE");
  const users = [];
  for (let i = 0; i < 3; i++) {
    const profile = profileSchema.parse({
      name: "PRIVATE_NAME",
      business: "PRIVATE_BUSINESS",
      industry: "수산물",
      region: "부산",
      contact: "0109900880" + i,
    });
    const [u] = await db()<
      User[]
    >`INSERT INTO members(phone,role,profile,admin) VALUES(${"0109900880" + i},'buyer',${db().json(profile)},${i === 2}) RETURNING *`;
    users.push(u);
  }
  [owner, other, admin] = users;
});
afterAll(async () => {
  await db().end();
});
const settings = (u: User, nickname: string, notifications = "true") =>
  mutate(u, "board/settings", { nickname, notifications });
const post = async () => {
  const result = await mutate(owner, "board/posts", {
    title: "게시판 검증",
    body: "공개 내용 <script>alert(1)</script>",
  });
  if (!("id" in result) || !result.id)
    throw new Error("Expected created post id");
  return { id: String(result.id) };
};
it("requires a nickname and enforces case-insensitive uniqueness", async () => {
  await expect(post()).rejects.toMatchObject({ status: 400 });
  await settings(owner, "Sea");
  await expect(settings(other, "sea")).rejects.toMatchObject({ status: 409 });
  await expect(settings(other, "가")).rejects.toBeTruthy();
  expect((await boardSettings(other)).nickname).toBeNull();
});
it("publishes only board fields and current nickname, not business identity", async () => {
  await settings(owner, "바다회원");
  const p = await post();
  const encoded = JSON.stringify([
    await boardList(),
    await boardPost(p.id!, null),
  ]);
  expect(encoded).toContain("바다회원");
  for (const secret of [
    "PRIVATE_NAME",
    "PRIVATE_BUSINESS",
    "01099008800",
    owner.id,
  ])
    expect(encoded).not.toContain(secret);
  await settings(owner, "변경별명");
  expect((await boardPost(p.id!, null))?.nickname).toBe("변경별명");
  expect(await boardList("%_")).toHaveLength(0);
});
it("creates generic comment alerts and respects settings and self-comments", async () => {
  await settings(owner, "작성자");
  await settings(other, "댓글회원");
  const p = await post();
  await mutate(other, "board/comments", {
    postId: p.id,
    body: "PRIVATE_COMMENT_TEXT",
  });
  let alerts =
    await db()`SELECT * FROM notifications WHERE user_id=${owner.id}`;
  expect(alerts).toHaveLength(1);
  expect(JSON.stringify(alerts)).not.toContain("PRIVATE_COMMENT_TEXT");
  await mutate(owner, "board/comments", { postId: p.id, body: "본인 댓글" });
  expect(
    await db()`SELECT id FROM notifications WHERE user_id=${owner.id}`,
  ).toHaveLength(1);
  await settings(owner, "작성자", "false");
  await db()`UPDATE board_comments SET created_at=now()-interval '11 seconds' WHERE author_id=${other.id}`;
  await mutate(other, "board/comments", {
    postId: p.id,
    body: "알림 끄기 확인",
  });
  alerts = await db()`SELECT * FROM notifications WHERE user_id=${owner.id}`;
  expect(alerts).toHaveLength(1);
});
it("blocks foreign edits, hides post comments and rejects further replies", async () => {
  await settings(owner, "작성자");
  await settings(other, "댓글회원");
  const p = await post();
  await expect(
    mutate(other, "board/posts", { id: p.id, title: "변조", body: "변조" }),
  ).rejects.toMatchObject({ status: 403 });
  await mutate(other, "board/comments", { postId: p.id, body: "댓글" });
  await expect(
    mutate(other, "board/moderate", {
      id: p.id,
      kind: "board_post",
      hidden: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await mutate(admin, "board/moderate", {
    id: p.id,
    kind: "board_post",
    hidden: true,
  });
  expect(await boardPost(p.id!, null)).toBeNull();
  expect(await boardComments(p.id!, null)).toHaveLength(0);
  await expect(
    mutate(other, "board/comments", { postId: p.id, body: "숨긴 글 댓글" }),
  ).rejects.toMatchObject({ status: 404 });
  await mutate(admin, "board/moderate", {
    id: p.id,
    kind: "board_post",
    hidden: false,
  });
  expect(await boardPost(p.id!, null)).not.toBeNull();
  await mutate(owner, "board/posts/delete", { id: p.id });
  expect(await boardList()).toHaveLength(0);
  await expect(
    mutate(admin, "board/moderate", {
      id: p.id,
      kind: "board_post",
      hidden: false,
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it("supports comment edit, moderation and deletion, rejects nonexistent reports", async () => {
  await settings(owner, "작성자");
  await settings(other, "댓글회원");
  const p = await post();
  await mutate(other, "board/comments", { postId: p.id, body: "첫 댓글" });
  const [c] = await boardComments(p.id!, other);
  await expect(
    mutate(owner, "board/comments/delete", { id: c.id }),
  ).rejects.toMatchObject({ status: 403 });
  await mutate(other, "board/comments", { id: c.id, body: "수정 댓글" });
  expect((await boardComments(p.id!, null))[0].body).toBe("수정 댓글");
  await mutate(owner, "reports", {
    kind: "board_comment",
    id: c.id,
    reason: "신고 검증 사유",
  });
  await mutate(admin, "board/moderate", {
    id: c.id,
    kind: "board_comment",
    hidden: true,
  });
  expect(await boardComments(p.id!, null)).toHaveLength(0);
  await mutate(admin, "board/moderate", {
    id: c.id,
    kind: "board_comment",
    hidden: false,
  });
  await mutate(other, "board/comments/delete", { id: c.id });
  expect(await boardComments(p.id!, null)).toHaveLength(0);
  await expect(
    mutate(owner, "reports", {
      kind: "board_post",
      id: owner.id,
      reason: "없는 대상 신고",
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it("serializes concurrent writes to enforce the posting interval", async () => {
  await settings(owner, "작성자");
  const results = await Promise.allSettled([post(), post()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await boardList()).toHaveLength(1);
});
it("keeps suspended authors out of public results and rejects their writes", async () => {
  await settings(owner, "작성자");
  const p = await post();
  await db()`UPDATE members SET suspended=true WHERE id=${owner.id}`;
  expect(await boardPost(p.id!, null)).toBeNull();
  expect(await boardList()).toHaveLength(0);
  await expect(post()).rejects.toMatchObject({ status: 401 });
});

it("includes reported comment content even when it is older than the admin recent list", async () => {
  await settings(owner, "작성자");
  await settings(other, "댓글회원");
  const p = await post();
  await mutate(other, "board/comments", {
    postId: p.id,
    body: "오래된 신고 댓글",
  });
  const [comment] = await boardComments(p.id, other);
  await db()`UPDATE board_comments SET created_at=now()-interval '2 days' WHERE id=${comment.id}`;
  await db()`INSERT INTO board_comments(post_id,author_id,body) SELECT ${p.id},${other.id},'다른 댓글' FROM generate_series(1,101)`;
  await mutate(owner, "reports", {
    kind: "board_comment",
    id: comment.id,
    reason: "오래된 댓글 신고 사유",
  });
  await mutate(admin, "board/moderate", {
    kind: "board_comment",
    id: comment.id,
    hidden: true,
  });
  const report = (await adminData()).reports.find(
    (r) => r.target_id === comment.id,
  );
  expect(report?.board_body).toBe("오래된 신고 댓글");
  expect(report?.board_post_id).toBe(p.id);
  expect(report?.board_hidden).toBe(true);
});

it("enforces daily quotas and excludes suspended commenters across page boundaries", async () => {
  await settings(owner, "경계작성자");
  await settings(other, "경계댓글회원");
  await db()`INSERT INTO board_posts(author_id,title,body,created_at) SELECT ${owner.id},'경계 검색 글','본문',now()-interval '1 hour' FROM generate_series(1,21)`;
  await expect(post()).rejects.toMatchObject({ status: 429 });
  expect(await boardList("경계 검색")).toHaveLength(21);
  expect(await boardList("경계 검색", 2)).toHaveLength(1);
  const [p] = await boardList();
  await db()`INSERT INTO board_comments(post_id,author_id,body,created_at) SELECT ${p.id},${other.id},'경계 댓글',now()-interval '1 hour' FROM generate_series(1,100)`;
  expect(await boardComments(p.id, null)).toHaveLength(51);
  expect(await boardComments(p.id, null, 2)).toHaveLength(50);
  await expect(mutate(other, "board/comments", { postId: p.id, body: "한도 초과" })).rejects.toMatchObject({ status: 429 });
  await db()`UPDATE members SET suspended=true WHERE id=${other.id}`;
  expect(await boardComments(p.id, null)).toHaveLength(0);
  expect((await boardList()).find((row) => row.id === p.id)?.comments).toBe(0);
  await mutate(admin, "board/moderate", { id: p.id, kind: "board_post", hidden: true });
  await expect(mutate(owner, "reports", { id: p.id, kind: "board_post", reason: "숨김 게시글 신고" })).rejects.toMatchObject({ status: 404 });
});
