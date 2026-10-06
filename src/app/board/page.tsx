import Link from "next/link";
import { boardList } from "@/server/board";
import { Heading } from "@/components/ui";
export const metadata = { title: "자유게시판" };
export default async function Board({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const p = await searchParams,
    q = typeof p.q === "string" ? p.q.trim().slice(0, 80) : "",
    page =
      typeof p.page === "string" && /^\d+$/.test(p.page)
        ? Math.min(1000, Math.max(1, Number(p.page)))
        : 1;
  const rows = await boardList(q, page);
  const href = (n: number) =>
    "/board?" + new URLSearchParams({ q, page: String(n) });
  return (
    <>
      <Heading
        title="자유게시판"
        action={
          <Link className="button" href="/board/new">
            글쓰기
          </Link>
        }
      />
      <form className="board-search">
        <label>
          제목·내용 검색
          <input name="q" defaultValue={q} maxLength={80} />
        </label>
        <button className="button">검색</button>
      </form>
      <div className="board-list">
        {rows.slice(0, 20).map((p) => (
          <article key={p.id}>
            <Link href={"/board/" + p.id}>
              <h2>{p.title}</h2>
              <span className="board-meta">
                {p.nickname} ·{" "}
                {new Date(p.created_at).toLocaleDateString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}{" "}
                · 댓글 {p.comments}
              </span>
            </Link>
          </article>
        ))}
      </div>
      {!rows.length && <p className="notice">게시글이 없습니다.</p>}
      <nav className="board-pagination" aria-label="게시판 페이지">
        {page > 1 && <Link href={href(page - 1)}>이전</Link>}
        <span>{page}페이지</span>
        {rows.length > 20 && page < 1000 && (
          <Link href={href(page + 1)}>다음</Link>
        )}
      </nav>
    </>
  );
}
