import { z } from "zod";
import { db } from "./db";
import { AppError, requireAdmin } from "./auth";
import type { User } from "../lib/model";
const uuid = z.string().uuid();
const text = (max: number) =>
  z.string().trim().min(1, "내용을 입력해주세요.").max(max);
export const nicknameSchema = z
  .string()
  .normalize("NFKC")
  .trim()
  .overwrite((value) => value.replace(/ +/g, " "))
  .min(2, "별명은 2자 이상 입력해주세요.")
  .max(20, "별명은 20자 이하로 입력해주세요.")
  .regex(
    /^[가-힣a-zA-Z0-9_ ]+$/,
    "별명은 한글·영문·숫자·공백·밑줄로 입력해주세요.",
  );
export async function boardSettings(user: User) {
  const [row] =
    await db()`SELECT nickname,board_notifications FROM members WHERE id=${user.id}`;
  return row;
}
export async function boardList(query = "", page = 1) {
  const q = query.trim().slice(0, 80);
  const offset = (Math.min(1000, Math.max(1, Math.floor(page) || 1)) - 1) * 20;
  return db()`SELECT p.id,p.title,p.created_at,m.nickname,
 (SELECT count(*)::int FROM board_comments c JOIN members a ON a.id=c.author_id WHERE c.post_id=p.id AND NOT c.hidden AND c.deleted_at IS NULL AND NOT a.suspended) AS comments
 FROM board_posts p JOIN members m ON m.id=p.author_id
 WHERE NOT p.hidden AND p.deleted_at IS NULL AND NOT m.suspended
 AND (${!q} OR position(${q} in p.title)>0 OR position(${q} in p.body)>0)
 ORDER BY p.created_at DESC,p.id DESC LIMIT 21 OFFSET ${offset}`;
}
export async function boardPost(id: string, user: User | null) {
  if (!uuid.safeParse(id).success) return null;
  const [post] =
    await db()`SELECT p.id,p.title,p.body,p.created_at,p.updated_at,m.nickname,(p.author_id=${user?.id || null}) AS own
 FROM board_posts p JOIN members m ON m.id=p.author_id WHERE p.id=${id} AND NOT p.hidden AND p.deleted_at IS NULL AND NOT m.suspended`;
  return post || null;
}
export async function boardComments(id: string, user: User | null, page = 1) {
  if (!(await boardPost(id, user))) return [];
  const offset = (Math.min(1000, Math.max(1, Math.floor(page) || 1)) - 1) * 50;
  return db()`SELECT c.id,c.body,c.created_at,m.nickname,(c.author_id=${user?.id || null}) AS own
 FROM board_comments c JOIN members m ON m.id=c.author_id
 JOIN board_posts p ON p.id=c.post_id JOIN members a ON a.id=p.author_id
 WHERE c.post_id=${id} AND NOT c.hidden AND c.deleted_at IS NULL AND NOT m.suspended
 AND NOT p.hidden AND p.deleted_at IS NULL AND NOT a.suspended
 ORDER BY c.created_at DESC,c.id DESC LIMIT 51 OFFSET ${offset}`;
}
export async function boardAdmin(user: User) {
  requireAdmin(user);
  return db()`SELECT p.id,'board_post' AS kind,p.title,p.body,p.hidden,p.created_at,m.nickname FROM board_posts p JOIN members m ON m.id=p.author_id WHERE p.deleted_at IS NULL
 UNION ALL SELECT c.id,'board_comment', '댓글',c.body,c.hidden,c.created_at,m.nickname FROM board_comments c JOIN members m ON m.id=c.author_id WHERE c.deleted_at IS NULL
 ORDER BY created_at DESC LIMIT 100`;
}
export async function mutateBoard(user: User, path: string, input: unknown) {
  const b = z.record(z.string(), z.unknown()).parse(input);
  try {
    return await db().begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${"board:" + user.id}))`;
      const [member] =
        await tx`SELECT nickname,board_notifications,suspended FROM members WHERE id=${user.id}`;
      if (!member || member.suspended)
        throw new AppError("로그인이 필요합니다.", 401);
      if (path === "board/settings") {
        const nickname = nicknameSchema.parse(b.nickname);
        const enabled = z
          .enum(["true", "false"], { error: "알림 설정을 선택해주세요." })
          .parse(b.notifications);
        await tx`UPDATE members SET nickname=${nickname},board_notifications=${enabled === "true"} WHERE id=${user.id}`;
        return { ok: true };
      }
      if (path === "board/moderate") {
        requireAdmin(user);
        const kind = z.enum(["board_post", "board_comment"]).parse(b.kind),
          id = uuid.parse(b.id),
          hidden = z.boolean().parse(b.hidden);
        const table = kind === "board_post" ? "board_posts" : "board_comments";
        const rows =
          await tx`UPDATE ${tx(table)} SET hidden=${hidden} WHERE id=${id} AND deleted_at IS NULL RETURNING id`;
        if (!rows.length) throw new AppError("게시물이 없습니다.", 404);
        await tx`INSERT INTO audit_log(actor_id,action,target,detail) VALUES(${user.id},'board.moderate',${id},${tx.json({ kind, hidden })})`;
        return { ok: true };
      }
      if (
        ![
          "board/posts",
          "board/posts/delete",
          "board/comments",
          "board/comments/delete",
        ].includes(path)
      )
        throw new AppError("찾을 수 없습니다.", 404);
      if (!member.nickname)
        throw new AppError("별명을 먼저 설정해주세요.", 400);
      const comment = path.startsWith("board/comments"),
        deleting = path.endsWith("/delete");
      const id = b.id ? uuid.parse(b.id) : null;
      if (deleting && !id) throw new AppError("게시물을 선택해주세요.");
      const table = comment ? "board_comments" : "board_posts";
      const [old] = id
        ? await tx`SELECT * FROM ${tx(table)} WHERE id=${id}`
        : [];
      if (
        id &&
        (!old || old.author_id !== user.id || old.deleted_at || old.hidden)
      )
        throw new AppError("수정할 수 없는 게시물입니다.", 403);
      let parent;
      if (comment) {
        const postId = old ? old.post_id : uuid.parse(b.postId);
        [parent] =
          await tx`SELECT p.*,m.board_notifications,m.suspended FROM board_posts p JOIN members m ON m.id=p.author_id WHERE p.id=${postId} FOR UPDATE OF p`;
        if (!parent || parent.hidden || parent.deleted_at || parent.suspended)
          throw new AppError("게시글을 찾을 수 없습니다.", 404);
      }
      if (deleting) {
        const rows =
          await tx`UPDATE ${tx(table)} SET deleted_at=now(),updated_at=now() WHERE id=${id} AND NOT hidden AND deleted_at IS NULL RETURNING id`;
        if (!rows.length)
          throw new AppError("수정할 수 없는 게시물입니다.", 403);
        return { id: comment ? parent!.id : id };
      }
      const body = text(comment ? 2000 : 10000).parse(b.body);
      const title = comment ? "" : text(100).parse(b.title);
      if (!id) {
        const [rate] =
          await tx`SELECT count(*)::int AS count,coalesce(bool_or(created_at>now()-interval '10 seconds'),false) AS recent FROM ${tx(table)} WHERE author_id=${user.id} AND created_at>now()-interval '1 day'`;
        if (rate.recent || rate.count >= (comment ? 100 : 20))
          throw new AppError(
            "잠시 후 다시 작성해주세요. 하루 작성 한도는 글 20개, 댓글 100개입니다.",
            429,
          );
      }
      if (id) {
        const rows = comment
          ? await tx`UPDATE board_comments SET body=${body},updated_at=now() WHERE id=${id} AND NOT hidden AND deleted_at IS NULL RETURNING id`
          : await tx`UPDATE board_posts SET title=${title},body=${body},updated_at=now() WHERE id=${id} AND NOT hidden AND deleted_at IS NULL RETURNING id`;
        if (!rows.length)
          throw new AppError("수정할 수 없는 게시물입니다.", 403);
        return { id: comment ? parent!.id : id };
      }
      if (!comment) {
        const [post] =
          await tx`INSERT INTO board_posts(author_id,title,body) VALUES(${user.id},${title},${body}) RETURNING id`;
        return { id: post.id };
      }
      await tx`INSERT INTO board_comments(post_id,author_id,body) VALUES(${parent!.id},${user.id},${body})`;
      if (parent!.author_id !== user.id && parent!.board_notifications)
        await tx`INSERT INTO notifications(user_id,title,body,href) VALUES(${parent!.author_id},'새 댓글','내 게시글에 댓글이 달렸습니다.',${"/board/" + parent!.id})`;
      return { id: parent!.id };
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "23505")
      throw new AppError("이미 사용 중인 별명입니다.", 409);
    throw e;
  }
}
