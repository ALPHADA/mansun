import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth";
import { boardPost, boardComments, boardSettings } from "@/server/board";
import { Back, LoginGate } from "@/components/ui";
import { Action, ActionForm, Report } from "@/components/actions";
import { BoardSettings } from "@/components/board-settings";
export const metadata = { title: "게시글" };
export default async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params,
    u = await currentUser(),
    p = await boardPost(id, u);
  if (!p) notFound();
  const raw = (await searchParams).page,
    page =
      typeof raw === "string" && /^\d+$/.test(raw)
        ? Math.min(1000, Math.max(1, Number(raw)))
        : 1;
  const comments = await boardComments(id, u, page),
    settings = u ? await boardSettings(u) : null;
  return (
    <div className="narrow">
      <Back href="/board" label="자유게시판" />
      <article className="board-post">
        <h1>{p.title}</h1>
        <p className="board-meta">
          {p.nickname} ·{" "}
          {new Date(p.created_at).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}
        </p>
        <div className="board-body">{p.body}</div>
        {p.own && (
          <div className="row wrap">
            <Link className="button secondary" href={`/board/${id}/edit`}>
              수정
            </Link>
            <Action
              endpoint="board/posts/delete"
              payload={{ id }}
              to="/board"
              confirmMessage="글을 삭제할까요? 댓글도 더 이상 공개되지 않습니다."
            >
              삭제
            </Action>
          </div>
        )}
        {u && <Report id={id} kind="board_post" />}
      </article>
      <section className="board-comments">
        <h2>댓글 · 최신순</h2>
        {comments.slice(0, 50).map((c) => (
          <article key={c.id} id={`comment-${c.id}`}>
            <p className="board-meta">
              {c.nickname} ·{" "}
              {new Date(c.created_at).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}
            </p>
            <p className="board-body">{c.body}</p>
            {c.own && (
              <>
                <details>
                  <summary>댓글 수정</summary>
                  <ActionForm
                    endpoint="board/comments"
                    redirect={`/board/${id}?page=${page}`}
                    submitLabel="수정 저장"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <label>
                      댓글 내용
                      <textarea
                        name="body"
                        defaultValue={c.body}
                        required
                        maxLength={2000}
                      />
                    </label>
                  </ActionForm>
                </details>
                <Action
                  endpoint="board/comments/delete"
                  payload={{ id: c.id }}
                  confirmMessage="댓글을 삭제할까요?"
                >
                  삭제
                </Action>
              </>
            )}
            {u && <Report id={c.id} kind="board_comment" />}
          </article>
        ))}
        {!comments.length && <p>댓글이 없습니다.</p>}
        <nav className="board-pagination" aria-label="댓글 페이지">
          {page > 1 && (
            <Link href={`/board/${id}?page=${page - 1}`}>이전 댓글</Link>
          )}
          {comments.length > 50 && page < 1000 && (
            <Link href={`/board/${id}?page=${page + 1}`}>다음 댓글</Link>
          )}
        </nav>
        {!u ? (
          <LoginGate
            next={`/board/${id}`}
            message="로그인하고 댓글을 작성하세요"
          />
        ) : !settings?.nickname ? (
          <BoardSettings
            nickname={null}
            enabled={settings?.board_notifications ?? true}
            next={`/board/${id}`}
          />
        ) : (
          <ActionForm
            endpoint="board/comments"
            redirect={`/board/${id}`}
            submitLabel="댓글 등록"
            resetOnSuccess
          >
            <input type="hidden" name="postId" value={id} />
            <label>
              댓글 쓰기
              <textarea name="body" required maxLength={2000} rows={3} />
            </label>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
