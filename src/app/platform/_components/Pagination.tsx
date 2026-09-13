import Link from "next/link";

/** 검색 파라미터를 유지하며 page 만 바꾸는 페이지네이션 */
export function Pagination({ page, pages, total, params, basePath }: { page: number; pages: number; total: number; params: Record<string, string | undefined>; basePath: string }) {
  if (pages <= 1) return <div className="pagination muted small">총 {total.toLocaleString("ko-KR")}건</div>;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  const window = 2;
  const nums: number[] = [];
  for (let p = Math.max(1, page - window); p <= Math.min(pages, page + window); p++) nums.push(p);
  return (
    <div className="pagination" aria-label="페이지">
      <Link href={href(1)} className={page === 1 ? "disabled" : undefined} aria-disabled={page === 1}>«</Link>
      <Link href={href(page - 1)} className={page === 1 ? "disabled" : undefined} aria-disabled={page === 1}>‹</Link>
      {nums[0] > 1 && <span>…</span>}
      {nums.map((p) => p === page ? <span key={p} className="current">{p}</span> : <Link key={p} href={href(p)}>{p}</Link>)}
      {nums[nums.length - 1] < pages && <span>…</span>}
      <Link href={href(page + 1)} className={page === pages ? "disabled" : undefined} aria-disabled={page === pages}>›</Link>
      <Link href={href(pages)} className={page === pages ? "disabled" : undefined} aria-disabled={page === pages}>»</Link>
      <span className="muted small" style={{ border: "none" }}>{page}/{pages} · 총 {total.toLocaleString("ko-KR")}건</span>
    </div>
  );
}
