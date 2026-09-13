"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useServerNow } from "@/components/ServerClock";
import { won, num } from "@/lib/format";
import { placeBidAction, requestBidOtp } from "../../actions";

export interface QuickPrice { price: number; label: string }

export function BidForm({ code, auctionId, unit, quantity, reservePrice, myBid, quick, quickSource, closeAt, biddable, notStarted, isRebid, rebidEligible, mfaRequired, modificationAllowed }: {
  code: string; auctionId: string; unit: string; quantity: number; reservePrice: number | null;
  myBid: { price: number; revision: number; isRebid: boolean; memo: string | null } | null;
  quick: QuickPrice[]; quickSource: string | null;
  closeAt: string | null; biddable: boolean; notStarted: boolean; isRebid: boolean; rebidEligible: boolean;
  mfaRequired: boolean; modificationAllowed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const now = useServerNow();
  const [pending, start] = useTransition();
  const [price, setPrice] = useState<string>(myBid ? String(myBid.price) : "");
  const [memo, setMemo] = useState<string>(myBid?.memo ?? "");
  const [expired, setExpired] = useState(() => (closeAt ? new Date(closeAt).getTime() <= now() : !biddable));
  const [confirm, setConfirm] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onExpire = useCallback(() => setExpired(true), []);

  const p = Number(price.replace(/[^0-9]/g, "")) || 0;
  const total = useMemo(() => Math.round(p * quantity), [p, quantity]);
  const alreadyBid = !!myBid;
  const lockedByPolicy = alreadyBid && !isRebid && !modificationAllowed;
  const disabled = expired || !biddable || notStarted || !rebidEligible || lockedByPolicy || pending;

  // 마감 감시 (Countdown 은 페이지 상단에 있으므로 여기서 별도 타이머)
  useCountdownExpire(closeAt, now, onExpire);

  const validate = (): string | null => {
    if (p <= 0) return "입찰가를 입력하세요";
    if (!Number.isInteger(p)) return "입찰가는 정수로 입력하세요";
    if (reservePrice != null && p < reservePrice) return `최저가(${won(reservePrice)}) 이상으로 입찰하세요`;
    if (isRebid && myBid && p < myBid.price) return `재입찰가는 기존 입찰가(${won(myBid.price)}) 이상이어야 합니다`;
    if (memo.length > 50) return "메모는 50자 이내";
    return null;
  };

  const openConfirm = () => {
    const e = validate();
    if (e) { setError(e); toast(e); return; }
    setError(null); setOtp(""); setDevCode(null); setOtpStep(false); setConfirm(true);
  };

  const submit = () => {
    start(async () => {
      if (mfaRequired && !otpStep) {
        const r = await requestBidOtp(code);
        if (!r.ok) { setError(r.error); toast(r.error); return; }
        setDevCode(r.data?.devCode ?? null); setOtpStep(true);
        return;
      }
      if (mfaRequired && otp.trim().length !== 6) { setError("인증번호 6자리를 입력하세요"); return; }
      const r = await placeBidAction(code, auctionId, { price: p, memo: memo || null, otp: mfaRequired ? otp.trim() : null });
      if (!r.ok) { setError(r.error); toast(r.error); if (r.code === "state") setExpired(true); return; }
      setConfirm(false);
      toast(r.data?.modified ? `✅ 입찰 수정 완료 (${r.data.revision}차)` : "✅ 입찰 완료 · 결과는 마감 후 알림");
      router.push(`/t/${code}/broker/results`);
    });
  };

  const buttonLabel = expired ? "⛔ 마감됨" : notStarted ? "시작 전" : !rebidEligible ? "재입찰 대상 아님" : lockedByPolicy ? "입찰 완료 (수정 불가)" : alreadyBid ? (isRebid ? "🔁 재입찰하기" : "🔨 입찰 수정하기") : "🔨 입찰하기";

  return (
    <>
      <div className="bid-input-wrap">
        <div className="input-label">입찰가 ({unit}당)</div>
        <div className="input-row">
          <input type="text" inputMode="numeric" placeholder="0" value={p ? num(p) : ""} onChange={(e) => { setPrice(e.target.value.replace(/[^0-9]/g, "")); setError(null); }} disabled={disabled && !pending} aria-label="입찰가" />
          <span className="currency">원 / {unit}</span>
        </div>
        {quick.length > 0 && (
          <div className="quick-btns" style={{ marginTop: 10, marginBottom: 0 }}>
            {quick.map((q) => <button key={q.label} type="button" onClick={() => { setPrice(String(q.price)); setError(null); }} disabled={disabled}><span className="small muted">{q.label}</span><br />{num(q.price)}</button>)}
          </div>
        )}
        {quickSource && <div className="hint">📈 {quickSource}</div>}
        {!quickSource && <div className="hint muted">최근 30일 낙찰 시세 정보가 없습니다</div>}
        {reservePrice != null && <div className="hint">최저가(예가) {won(reservePrice)}/{unit} 이상</div>}
        <div className="total-preview">총액 미리보기: {p > 0 ? <strong>{won(total)}</strong> : "— 원"} <span className="small">({num(p)}원 × {num(quantity)}{unit})</span></div>
        <div className="memo">
          <input type="text" maxLength={50} placeholder="메모 (선택, 50자 이내 · 본인만 열람)" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={disabled && !pending} />
        </div>
        {error && <div className="text-danger small mt-8">{error}</div>}
      </div>

      <button type="button" className="btn-bid" onClick={openConfirm} disabled={disabled}>{pending ? <span className="spinner" /> : buttonLabel}</button>
      <button type="button" className="btn-secondary" style={{ width: "100%", marginTop: 10 }} onClick={() => router.push(`/t/${code}/broker/auctions`)}>목록으로</button>
      {alreadyBid && !isRebid && modificationAllowed && !expired && <div className="small muted mt-8" style={{ textAlign: "center" }}>마감 전까지 수정 가능 · 최종 제출값만 유효</div>}

      {confirm && (
        <ConfirmModal
          title={otpStep ? "본인 인증" : alreadyBid ? "입찰 수정 확인" : "입찰 확인"}
          confirmLabel={mfaRequired && !otpStep ? "인증번호 받기" : otpStep ? "인증 후 입찰" : "입찰하기"}
          onConfirm={submit} onClose={() => !pending && setConfirm(false)} busy={pending}
          message={<>
            <strong>{unit}당 {won(p)} × {num(quantity)}{unit} = {won(total)}</strong>으로 {alreadyBid ? "수정 " : ""}입찰하시겠습니까?
          </>}
        >
          <div className="small muted" style={{ lineHeight: 1.7 }}>
            {isRebid ? "재입찰은 기존 입찰가 이상으로만 가능합니다." : modificationAllowed ? "* 마감 전까지 수정 가능합니다 (최종값만 유효)." : "* 이 수협은 입찰 수정을 허용하지 않습니다 (1회 확정)."}<br />
            * 서버 시각 기준 마감. 마감 후 제출은 무효 처리됩니다.
          </div>
          {otpStep && (
            <div className="otp-box">
              <label>인증번호 (6자리)</label>
              <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))} autoFocus />
              {devCode && <div className="dev-code">개발 모드 인증번호: <strong>{devCode}</strong></div>}
              <button type="button" className="btn-ghost small" onClick={() => start(async () => { const r = await requestBidOtp(code); if (r.ok) { setDevCode(r.data?.devCode ?? null); toast("인증번호를 다시 발송했습니다"); } else toast(r.error); })} disabled={pending}>재발송</button>
            </div>
          )}
          {error && <div className="text-danger small mt-8">{error}</div>}
        </ConfirmModal>
      )}
    </>
  );
}

function useCountdownExpire(closeAt: string | null, now: () => number, onExpire: () => void) {
  useEffect(() => {
    if (!closeAt) return;
    const target = new Date(closeAt).getTime();
    if (target <= now()) { onExpire(); return; }
    const id = setInterval(() => { if (target <= now()) { onExpire(); clearInterval(id); } }, 1000);
    return () => clearInterval(id);
  }, [closeAt, now, onExpire]);
}
