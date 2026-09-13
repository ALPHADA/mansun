import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/context";
import { getAuction } from "@/services/auction";
import { myBidFor, recentAveragePrice } from "@/services/bid";
import { Countdown } from "@/components/Countdown";
import { num, unitLabel, won } from "@/lib/format";
import { GRADE_LABEL, TIE_BREAK_LABEL } from "@/domain/status";
import { BidForm, type QuickPrice } from "./BidForm";

export const metadata = { title: "입찰" };

const round100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);

export default async function BidPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const ctx = await requireTenantContext(code);
  const detail = await getAuction(ctx.tenant.id, id);
  if (!detail) notFound();
  const a = detail.auction;
  const t = ctx.tenant;
  const [my, avg] = await Promise.all([myBidFor(ctx, a.id), recentAveragePrice(t.id, a.speciesCode, a.unit)]);

  const unit = unitLabel(a.unit);
  const isRebid = a.status === "rebid";
  const closeAt = isRebid ? a.rebidUntil : detail.round?.bidCloseAt ?? null;
  const startAt = detail.round?.bidStartAt ?? null;
  const now = Date.now();
  const notStarted = a.status === "announced" || a.status === "registered" || (startAt ? startAt.getTime() > now : false);
  const biddable = ["open", "closing", "rebid"].includes(a.status) && !notStarted && !!closeAt && closeAt.getTime() > now;
  const rebidEligible = !isRebid || (!!my && my.isRebid);

  // 빠른 가격 버튼
  let quick: QuickPrice[] = [];
  let quickSource: string | null = null;
  if (avg) {
    quick = [[-5, "−5%"], [0, "시세"], [5, "+5%"], [10, "+10%"]].map(([p, l]) => ({ price: round100(avg.avg * (1 + Number(p) / 100)), label: String(l) }));
    quickSource = `최근 30일 ${detail.speciesName ?? a.speciesCode} 낙찰 ${avg.n}건 평균 ${won(avg.avg)}/${unit}`;
  } else if (my) {
    quick = [[-5, "−5%"], [0, "현재"], [5, "+5%"], [10, "+10%"]].map(([p, l]) => ({ price: round100(my.price * (1 + Number(p) / 100)), label: String(l) }));
    quickSource = "내 현재 입찰가 기준";
  } else if (a.reservePrice) {
    quick = [[0, "최저가"], [5, "+5%"], [10, "+10%"], [20, "+20%"]].map(([p, l]) => ({ price: round100(a.reservePrice! * (1 + Number(p) / 100)), label: String(l) }));
    quickSource = "최저가(예가) 기준";
  }
  if (isRebid && my) quick = quick.filter((q) => q.price >= my.price);

  const lotNo = a.auctionNo ? a.auctionNo.split("-").pop() : "-";
  const speciesName = detail.speciesName ?? a.speciesCode;

  return (
    <>
      <div className="flex mb-8"><Link href={`/t/${code}/broker/auctions`} className="back-btn" style={{ fontSize: 18 }}>‹</Link><h2 style={{ fontSize: 16 }}>{speciesName} 입찰</h2></div>

      <div className="detail-section">
        <h2>🐟 {speciesName} · {GRADE_LABEL[a.grade] ?? a.grade}</h2>
        <div className="detail-row"><span className="label">경매번호</span><span className="value">{lotNo} <span className="muted small">({a.auctionNo ?? "미부여"})</span></span></div>
        <div className="detail-row"><span className="label">선박 / 선주</span><span className="value">{detail.vesselName} / {detail.shipperName ?? "-"}</span></div>
        <div className="detail-row"><span className="label">중량</span><span className="value">{num(a.weightKg)} kg{a.unit !== "kg" && ` · ${num(a.quantity)} ${unit}`}</span></div>
        <div className="detail-row"><span className="label">입찰 단위</span><span className="value">{unit}당 단가</span></div>
        <div className="detail-row"><span className="label">등급</span><span className="value">{GRADE_LABEL[a.grade] ?? a.grade}</span></div>
        {a.reservePrice != null && <div className="detail-row"><span className="label">최저가(예가)</span><span className="value">{won(a.reservePrice)}/{unit}</span></div>}
        {a.note && <div className="detail-row"><span className="label">참고사항</span><span className="value">{a.note}</span></div>}
        <div className="detail-row">
          <span className="label">{isRebid ? "재입찰 마감까지" : "마감까지"}</span>
          <span className="value" style={{ color: "var(--color-danger)", fontWeight: 600 }}>
            {notStarted ? <span className="muted">시작 전{startAt ? ` (${startAt.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })} 시작)` : ""}</span>
              : closeAt ? <Countdown until={closeAt.toISOString()} prefix="⏱ " className="countdown" /> : "-"}
          </span>
        </div>
        {a.photos.length > 0 && (
          <div className="photo-grid detail">
            {a.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`${speciesName} 사진`} /></a>)}
          </div>
        )}
      </div>

      <div className="notice-box">
        🔒 <div>
          <strong>밀봉 입찰</strong>입니다. 다른 중매인의 입찰가는 마감 전후 모두 공개되지 않습니다. 서버 시각 기준으로 마감되며, 마감 후 입찰은 무효 처리됩니다.
        </div>
      </div>

      {isRebid && (
        <div className="notice-box" style={{ background: "#fee2e2", borderColor: "#fecaca", color: "#991b1b" }}>
          🔁 <div><strong>재입찰 진행 중</strong> — 동일 최고가가 발생하여 해당 입찰자만 재입찰합니다.{my?.isRebid ? " 기존 입찰가 이상으로만 제출할 수 있습니다." : " 귀하는 재입찰 대상이 아닙니다."}</div>
        </div>
      )}

      {my && (
        <div className="current-bid">
          <span>현재 입찰가 {my.revision > 1 && <span className="small">({my.revision}차 수정)</span>}</span>
          <strong>{won(my.price)}/{unit}</strong>
        </div>
      )}

      {ctx.readOnly ? (
        <div className="readonly-note">읽기 전용 상태입니다. 입찰할 수 없습니다.</div>
      ) : (
        <BidForm
          code={code} auctionId={a.id} unit={unit} quantity={a.quantity} reservePrice={a.reservePrice}
          myBid={my ? { price: my.price, revision: my.revision, isRebid: my.isRebid, memo: my.memo } : null}
          quick={quick} quickSource={quickSource}
          closeAt={closeAt ? closeAt.toISOString() : null} biddable={biddable} notStarted={notStarted} isRebid={isRebid} rebidEligible={rebidEligible}
          mfaRequired={t.bidMfaRequired} modificationAllowed={t.bidModificationAllowed}
        />
      )}

      <div className="policy-box">
        <strong>📋 입찰 정책 안내</strong><br />
        • {TIE_BREAK_LABEL[t.tieBreakPolicy] ?? t.tieBreakPolicy}<br />
        • 마감 전까지 입찰가 <strong>{t.bidModificationAllowed ? "수정 가능 (최종값만 유효)" : "1회 확정 (수정 불가)"}</strong><br />
        {t.fieldAuctionEnabled && <>• 디지털 마감 후 현장 호가식 경매와 비교하여 <strong>디지털 vs 현장 중 높은 가격</strong>이 최종 낙찰<br /></>}
        {a.reservePrice != null && <>• 최저가(예가) <strong>{won(a.reservePrice)}/{unit}</strong> 미만 입찰 불가<br /></>}
        {t.bidMfaRequired && <>• 입찰 제출 시 <strong>본인 인증(OTP)</strong> 필요</>}
      </div>
    </>
  );
}
