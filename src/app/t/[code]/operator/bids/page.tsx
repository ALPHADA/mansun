import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listAllBids } from "@/services/bid";
import { listActiveBrokers } from "@/services/auction";
import { listSpecies } from "@/services/species";
import { listRoundsWithCounts } from "@/services/dashboard";
import { AUCTION_STATUS, BID_STATUS } from "@/domain/status";
import { StatusBadge } from "@/components/Badge";
import { fmtDateTime, num, unitLabel, won } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";
import { parseBidFilters } from "./filters";

export const metadata = { title: "입찰 내역" };
const LIMIT = 300;

export default async function BidsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "bids.read_all")) notFound();
  const { raw, opts } = parseBidFilters(sp);

  const [rows, rounds, brokers, species] = await Promise.all([
    listAllBids(ctx.tenant.id, { ...opts, limit: LIMIT }),
    listRoundsWithCounts(ctx.tenant.id, { limit: 40 }),
    listActiveBrokers(ctx.tenant.id),
    listSpecies(),
  ]);
  const qs = new URLSearchParams(Object.entries(raw).filter(([, v]) => v)).toString();
  const total = rows.reduce((s, r) => s + r.bid.price, 0);

  return (
    <>
      <PageTitle title="전체 입찰 내역" uc="감사용">
        <span className="muted small">{rows.length}{rows.length >= LIMIT ? "+" : ""}건 · 최신순</span>
        <a href={`/t/${code}/operator/bids/export${qs ? `?${qs}` : ""}`} className="btn-secondary btn-sm" style={{ display: "inline-block" }}>⬇ CSV 내보내기</a>
      </PageTitle>

      <div className="panel">
        <div className="panel-header"><h2>필터</h2>{qs && <Link href={`/t/${code}/operator/bids`} className="small">초기화</Link>}</div>
        <div className="panel-body">
          <form method="get" className="filter-bar">
            <div><label>회차</label>
              <select name="round" defaultValue={raw.round}><option value="">전체</option>{rounds.map((r) => <option key={r.round.id} value={r.round.id}>{r.round.label}</option>)}</select></div>
            <div><label>중매인</label>
              <select name="broker" defaultValue={raw.broker}><option value="">전체</option>{brokers.map((b) => <option key={b.membershipId} value={b.membershipId}>{b.name}{b.licenseNo ? ` (${b.licenseNo})` : ""}</option>)}</select></div>
            <div><label>어종</label>
              <select name="species" defaultValue={raw.species}><option value="">전체</option>{species.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
            <div><label>상태</label>
              <select name="status" defaultValue={raw.status}><option value="">전체</option>{(Object.keys(BID_STATUS) as (keyof typeof BID_STATUS)[]).map((k) => <option key={k} value={k}>{BID_STATUS[k].label}</option>)}</select></div>
            <div><label>기간 (부터)</label><input type="date" name="from" defaultValue={raw.from} /></div>
            <div><label>기간 (까지)</label><input type="date" name="to" defaultValue={raw.to} /></div>
            <div className="span-2"><label>검색 (경매번호·중매인·면허)</label><input name="q" defaultValue={raw.q} placeholder="예: A01, 김중매, M-201" /></div>
            <div className="buttons"><button className="btn-primary" type="submit">조회</button></div>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>입찰 목록</h2><span className="muted small">입찰가 합계 {won(total)}</span></div>
        <div className="panel-body dense">
          {rows.length === 0 ? <div className="empty-state"><div className="emoji">📋</div>조건에 맞는 입찰이 없습니다</div> : (
            <table className="data-table">
              <thead><tr><th>경매번호</th><th>회차</th><th>어종</th><th>중매인</th><th>면허</th><th className="num">입찰가</th><th className="num">수정</th><th>입찰 시각</th><th>상태</th><th>경매</th><th className="num">낙찰가</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.bid.id}>
                    <td className="mono small">{r.auctionNo ?? "-"}</td>
                    <td className="small muted">{r.roundLabel ?? "-"}</td>
                    <td>{r.speciesName ?? r.speciesCode}</td>
                    <td>{r.brokerName}</td>
                    <td className="mono small">{r.licenseNo ?? "-"}</td>
                    <td className="num">{num(r.bid.price)}<span className="muted small">/{unitLabel(r.unit)}</span></td>
                    <td className="num">{r.bid.revision > 1 ? <span title={`${r.bid.revision - 1}회 수정`}>{r.bid.revision - 1}회</span> : <span className="muted">-</span>}{r.bid.isRebid && <span className="badge badge-warning" style={{ marginLeft: 4 }}>재입찰</span>}</td>
                    <td className="mono small">{fmtDateTime(r.bid.submittedAt, { second: "2-digit" })}</td>
                    <td><StatusBadge map={BID_STATUS} value={r.bid.status} /></td>
                    <td><StatusBadge map={AUCTION_STATUS} value={r.auctionStatus} /></td>
                    <td className="num">{r.finalPrice != null ? num(r.finalPrice) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
