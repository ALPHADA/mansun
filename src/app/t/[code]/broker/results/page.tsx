import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/context";
import { myBids } from "@/services/bid";
import { Badge } from "@/components/Badge";
import { fmtDateTime, localDateStr, num, unitLabel, won } from "@/lib/format";

export const metadata = { title: "내 입찰 결과" };

type Filter = "all" | "won" | "lost" | "pending";
const FILTERS: { key: Filter; label: string }[] = [{ key: "all", label: "전체" }, { key: "won", label: "낙찰" }, { key: "lost", label: "패찰" }, { key: "pending", label: "대기" }];

export default async function BrokerResultsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const f: Filter = (["all", "won", "lost", "pending"] as Filter[]).includes(sp.f as Filter) ? (sp.f as Filter) : "all";
  const ctx = await requireTenantContext(code);
  const rows = await myBids(ctx);
  const t = ctx.tenant;

  const kind = (r: (typeof rows)[number]): Filter => r.bid.status === "awarded" ? "won" : r.bid.status === "lost" || r.bid.status === "invalid" ? "lost" : "pending";
  const counts: Record<Filter, number> = { all: rows.length, won: 0, lost: 0, pending: 0 };
  for (const r of rows) counts[kind(r)] += 1;

  const today = localDateStr();
  const todayWon = rows.filter((r) => r.bid.status === "awarded" && r.auction.awardedAt && localDateStr(r.auction.awardedAt) === today);
  const todayTotal = todayWon.reduce((s, r) => s + Math.round((r.auction.finalPrice ?? r.bid.price) * r.auction.quantity * (r.myShare ?? 1)), 0);

  const list = (f === "all" ? rows : rows.filter((r) => kind(r) === f))
    .sort((a, b) => Math.max(b.auction.awardedAt?.getTime() ?? 0, b.bid.submittedAt.getTime()) - Math.max(a.auction.awardedAt?.getTime() ?? 0, a.bid.submittedAt.getTime()));

  const winnerLabel = (r: (typeof rows)[number]) => {
    if (r.auction.awardSource === "field" && !r.winnerLicense) return "현장 낙찰자";
    return t.winnerDisclosure === "license_no" ? (r.winnerLicense ? `면허 ${r.winnerLicense}` : "-") : "비공개";
  };

  return (
    <>
      <div className="hero-card">
        <div className="hero-label">오늘의 낙찰</div>
        <div className="hero-value">{todayWon.length} 건</div>
        <div style={{ fontSize: 13, opacity: 0.9 }}>총 {won(todayTotal)} <span style={{ opacity: 0.8 }}>(수수료 별도)</span></div>
      </div>

      <div className="seg-tabs">
        {FILTERS.map((x) => <Link key={x.key} href={`/t/${code}/broker/results${x.key === "all" ? "" : `?f=${x.key}`}`} className={f === x.key ? "active" : ""}>{x.label} {counts[x.key]}</Link>)}
      </div>

      {list.length === 0 && <div className="empty-state"><div className="emoji">📋</div>{f === "all" ? "입찰 내역이 없습니다" : "해당 조건의 입찰이 없습니다"}</div>}

      {list.map((r) => {
        const a = r.auction; const b = r.bid; const k = kind(r);
        const unit = unitLabel(a.unit);
        const lotNo = a.auctionNo ? a.auctionNo.split("-").pop() : "-";
        const qtyLabel = a.unit === "kg" ? `${num(a.weightKg)}kg` : `${num(a.quantity)}${unit}`;
        const title = `${r.speciesName ?? a.speciesCode} · ${qtyLabel}`;
        const shipLine = `${r.vesselName} · ${r.shipperName ?? "-"} · ${lotNo}`;
        const source = a.awardSource === "field" ? "현장" : "디지털";
        const isPassed = a.status === "passed";
        const isDisputed = a.status === "disputed";

        if (k === "won") {
          const share = r.myShare ?? 1;
          const total = Math.round((a.finalPrice ?? b.price) * a.quantity * share);
          return (
            <div key={b.id} className="result-card won">
              <div className="top-row"><div className="fish-name">{title}</div><Badge tone="success">✅ 낙찰{share < 1 ? ` · 분할 ${Math.round(share * 100)}%` : ""}{a.status === "settled" ? " · 정산완료" : ""}</Badge></div>
              <div className="ship-line">{shipLine}</div>
              <div className="price-line"><span className="muted-label">내 입찰가{b.revision > 1 ? ` (${b.revision}차)` : ""}</span><span><strong>{num(b.price)}</strong> 원/{unit}</span></div>
              <div className="price-line"><span className="muted-label">낙찰가 (최종)</span><span style={{ color: "var(--color-success)" }}><strong>{num(a.finalPrice ?? b.price)}</strong> 원/{unit}</span></div>
              <div className="price-line"><span className="muted-label">총액</span><span><strong>{num(total)}</strong> 원</span></div>
              <div className="price-line"><span className="muted-label">출처 · 시각</span><span className="small">{source} · {fmtDateTime(a.awardedAt)}</span></div>
              <div className="pickup">📦 인수 안내: {t.pickupInstructions ?? "인수 시각·장소는 수협 운영자 안내를 따르세요"}</div>
            </div>
          );
        }
        if (k === "lost") {
          return (
            <div key={b.id} className="result-card lost">
              <div className="top-row"><div className="fish-name">{title}</div><Badge tone={isPassed ? "danger" : "muted"}>{isPassed ? "유찰" : b.status === "invalid" ? "무효" : "패찰"}</Badge></div>
              <div className="ship-line">{shipLine}</div>
              <div className="price-line"><span className="muted-label">내 입찰가{b.revision > 1 ? ` (${b.revision}차)` : ""}</span><span>{num(b.price)} 원/{unit}</span></div>
              {isPassed ? (
                <div className="price-line"><span className="muted-label">사유</span><span className="small">{a.reservePrice ? `최저가(${won(a.reservePrice)}) 미달` : "유찰"}</span></div>
              ) : (
                <div className="price-line"><span className="muted-label">낙찰가</span><span>{a.finalPrice != null ? `${num(a.finalPrice)} 원/${unit}` : "-"} <span className="small muted">({source}{a.finalPrice != null ? ` · ${winnerLabel(r)}` : ""})</span></span></div>
              )}
            </div>
          );
        }
        return (
          <div key={b.id} className="result-card">
            <Link href={`/t/${code}/broker/bid/${a.id}`} className="card-link">
              <div className="top-row"><div className="fish-name">{title}</div><Badge tone={isDisputed ? "danger" : a.status === "rebid" ? "warning" : b.status === "submitted" && ["open", "closing", "announced"].includes(a.status) ? "info" : "warning"}>{isDisputed ? "분쟁 검토중" : a.status === "rebid" ? (b.isRebid ? "재입찰 중" : "재입찰 진행") : ["open", "closing", "announced"].includes(a.status) ? "입찰중" : "개찰 대기"}</Badge></div>
              <div className="ship-line">{shipLine}</div>
              <div className="price-line"><span className="muted-label">내 입찰가{b.revision > 1 ? ` (${b.revision}차)` : ""}</span><span><strong>{num(b.price)}</strong> 원/{unit}</span></div>
              <div className="price-line"><span className="muted-label">제출 시각</span><span className="small">{fmtDateTime(b.submittedAt)}</span></div>
              <div className="pending-note">⏳ {["open", "closing", "announced"].includes(a.status) ? "디지털 마감 전 — 탭하여 입찰 수정" : "개찰 대기 — 결과는 개찰 후 알림으로 안내됩니다"}</div>
            </Link>
          </div>
        );
      })}
    </>
  );
}
