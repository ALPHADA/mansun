import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/context";
import { listAuctions, type AuctionRow } from "@/services/auction";
import { myBids } from "@/services/bid";
import { Countdown } from "@/components/Countdown";
import { num, unitLabel, won } from "@/lib/format";
import { GRADE_LABEL } from "@/domain/status";

export const metadata = { title: "진행중 경매" };

function quantityLabel(a: AuctionRow["auction"]) {
  if (a.unit === "kg") return <span><strong>{num(a.weightKg)}</strong> kg</span>;
  const perKg = a.quantity > 0 ? a.weightKg / a.quantity : null;
  // 마리 단위는 g, 박스는 kg 로 표기 (0.4kg/마리 → 400g/마리)
  const per = perKg == null ? "" : perKg < 1 ? ` (${Math.round(perKg * 1000)}g/${unitLabel(a.unit)})` : ` (${num(perKg, 1)}kg/${unitLabel(a.unit)})`;
  return <span><strong>{num(a.quantity)}</strong> {unitLabel(a.unit)}{per} · {num(a.weightKg)}kg</span>;
}

export default async function BrokerAuctionsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const { species } = await searchParams;
  const ctx = await requireTenantContext(code);
  const [rows, mine] = await Promise.all([
    listAuctions(ctx.tenant.id, { status: ["announced", "open", "closing", "rebid"] }),
    myBids(ctx, { status: ["submitted", "closed"] }),
  ]);
  const myByAuction = new Map(mine.map((m) => [m.bid.auctionId, m.bid]));
  const now = Date.now();

  // 어종 칩 (건수)
  const counts = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    const c = counts.get(r.auction.speciesCode) ?? { name: r.speciesName ?? r.auction.speciesCode, n: 0 };
    c.n += 1; counts.set(r.auction.speciesCode, c);
  }
  const filtered = species ? rows.filter((r) => r.auction.speciesCode === species) : rows;

  // 배너: 가장 빠른 디지털 마감
  const live = rows.filter((r) => r.round && r.round.bidCloseAt.getTime() > now && r.auction.status !== "announced");
  const earliest = live.reduce<AuctionRow | null>((acc, r) => (!acc || r.round!.bidCloseAt < acc.round!.bidCloseAt ? r : acc), null);
  const roundLabels = [...new Set(rows.map((r) => r.round?.label).filter((x): x is string => !!x))];

  return (
    <>
      <div className="live-banner stack">
        <div className="label">{earliest ? "🟢 LIVE" : "⚪ 대기"} · {roundLabels.length ? roundLabels.join(" / ") : "진행중 회차 없음"}</div>
        <div className="timer-line">디지털 마감까지 {earliest ? <Countdown until={earliest.round!.bidCloseAt.toISOString()} className="timer" /> : <span className="timer">--:--</span>}</div>
        <div className="sub">서버시각 기준 · 마감 후 입찰 불가</div>
      </div>

      {rows.length > 0 && (
        <div className="chips">
          <Link href={`/t/${code}/broker/auctions`} className={`chip${!species ? " active" : ""}`}>전체 {rows.length}</Link>
          {[...counts.entries()].map(([c, v]) => (
            <Link key={c} href={`/t/${code}/broker/auctions?species=${c}`} className={`chip${species === c ? " active" : ""}`}>{v.name} {v.n}</Link>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="empty-state"><div className="emoji">🐟</div>{species ? "해당 어종의 진행중 경매가 없습니다" : "진행중인 경매가 없습니다"}<div className="small mt-8">공지가 발송되면 알림으로 안내됩니다</div></div>
      )}

      {filtered.map((r) => {
        const a = r.auction;
        const my = myByAuction.get(a.id);
        const notStarted = a.status === "announced" || (r.round ? r.round.bidStartAt.getTime() > now : false);
        const isRebid = a.status === "rebid";
        const myRebid = isRebid && my?.isRebid;
        const lotNo = a.auctionNo ? a.auctionNo.split("-").pop() : "-";
        return (
          <Link key={a.id} href={`/t/${code}/broker/bid/${a.id}`} className={`auction-card${notStarted ? " muted" : ""}`}>
            <div className="card-top">
              <div>
                <div className="fish-name">{r.speciesName ?? a.speciesCode} · {GRADE_LABEL[a.grade] ?? a.grade}</div>
                <div className="ship-name">{r.vesselName} · {r.shipperName ?? "선주 미지정"}</div>
              </div>
              <div className="tag-row">
                {my && !isRebid && <span className="badge badge-success">입찰함 ✓</span>}
                {myRebid && <span className="badge badge-warning">재입찰 중</span>}
                {isRebid && !myRebid && <span className="badge badge-muted">재입찰 진행</span>}
                <span className="unit-tag">단위: {unitLabel(a.unit)}</span>
              </div>
            </div>
            <div className="meta-row">
              {quantityLabel(a)}
              {a.note && <span>{a.note}</span>}
            </div>
            <div className="countdown-row">
              <span className="lot-no">경매 {lotNo}{my && <> · <span className="my-bid">내 입찰 {won(my.price)}/{unitLabel(a.unit)}{my.revision > 1 ? ` (${my.revision}차)` : ""}</span></>}</span>
              {notStarted ? <span className="countdown cool">시작 전</span>
                : myRebid && a.rebidUntil ? <Countdown until={a.rebidUntil.toISOString()} prefix="재입찰 ⏱ " />
                : r.round ? <Countdown until={r.round.bidCloseAt.toISOString()} prefix="⏱ " />
                : <span className="countdown cool">-</span>}
            </div>
          </Link>
        );
      })}
    </>
  );
}
