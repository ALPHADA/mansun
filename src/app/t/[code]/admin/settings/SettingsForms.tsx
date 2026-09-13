"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { TIE_BREAK_LABEL, VISIBILITY_LABEL } from "@/domain/status";
import { won } from "@/lib/format";
import type { BoxWeightTable, FeePolicy, NotificationChannel, NotificationConfig, ReservePrices, ScheduleSlot, TieBreakPolicy, DigitalPriceVisibility, WinnerDisclosure } from "@/db/schema";
import type { SettingsSection } from "@/services/tenant-admin";
import { saveSettingsAction } from "./actions";

export interface TenantSettings {
  code: string; name: string; region: string | null; address: string | null; contactEmail: string | null; contactPhone: string | null; pickupInstructions: string | null; businessNo: string | null;
  digitalCloseBufferMin: number; tieBreakPolicy: TieBreakPolicy; digitalPriceVisibility: DigitalPriceVisibility; bidModificationAllowed: boolean;
  fieldAuctionEnabled: boolean; bidMfaRequired: boolean; winnerDisclosure: WinnerDisclosure; reservePrices: ReservePrices; schedule: ScheduleSlot[];
  boxWeightTable: BoxWeightTable; feePolicy: FeePolicy; notificationConfig: NotificationConfig; accountingAdapter: string;
}
export interface SpeciesOpt { code: string; name: string; defaultUnit: string }

interface Common { code: string; settings: TenantSettings; locked: boolean; canWrite: boolean }

function useSave(code: string, section: SettingsSection) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = (patch: unknown) => start(async () => {
    const r = await saveSettingsAction(code, section, patch);
    if (r.ok) { setErrors({}); toast(r.message ?? "저장했습니다"); router.refresh(); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error); }
  });
  return { save, pending, errors };
}

function Actions({ pending, canWrite }: { pending: boolean; canWrite: boolean }) {
  if (!canWrite) return null;
  return <div className="form-actions"><button type="submit" className="btn-primary" disabled={pending}>{pending ? <span className="spinner" /> : "저장"}</button></div>;
}
const Err = ({ m }: { m?: string }) => (m ? <div className="field-error">{m}</div> : null);
const Lock = ({ on }: { on: boolean }) => (on ? <span className="locked-tag">활성 경매 중 잠금</span> : null);

export function SettingsTab(props: Common & { tab: SettingsSection; species: SpeciesOpt[] }) {
  switch (props.tab) {
    case "general": return <GeneralForm {...props} />;
    case "auction": return <AuctionForm {...props} />;
    case "units": return <UnitsForm {...props} />;
    case "fees": return <FeesForm {...props} />;
    case "notification": return <NotificationForm {...props} />;
    case "accounting": return <AccountingForm {...props} />;
  }
}

// ───────── 일반 ─────────
function GeneralForm({ code, settings: s, canWrite }: Common) {
  const { save, pending, errors } = useSave(code, "general");
  const [f, setF] = useState({ name: s.name, region: s.region ?? "", address: s.address ?? "", contactEmail: s.contactEmail ?? "", contactPhone: s.contactPhone ?? "", pickupInstructions: s.pickupInstructions ?? "" });
  const ro = !canWrite;
  return (
    <form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); save(f); }}>
      <div className="panel-header"><h2>일반 정보</h2><span className="muted small">코드 <b className="mono">{s.code}</b>{s.businessNo && <> · 사업자 {s.businessNo}</>}</span></div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="field"><label>수협 이름 *</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} maxLength={40} required disabled={ro} /><Err m={errors.name} /></div>
          <div className="field"><label>지역</label><input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} placeholder="경상북도" disabled={ro} /><Err m={errors.region} /></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label>주소</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={ro} /><Err m={errors.address} /></div>
          <div className="field"><label>대표 이메일</label><input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} disabled={ro} /><Err m={errors.contactEmail} /></div>
          <div className="field"><label>대표 전화</label><input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="054-733-0001" disabled={ro} /><Err m={errors.contactPhone} /></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label>낙찰 후 인수 안내 (중매인 결과 화면·낙찰 알림에 표시)</label><input value={f.pickupInstructions} onChange={(e) => setF({ ...f, pickupInstructions: e.target.value })} maxLength={200} placeholder="예: 개찰 후 07:30까지 위판장 1구역에서 인수. 문의 054-733-0001" disabled={ro} /><Err m={errors.pickupInstructions} /></div>
        </div>
        <p className="hint">수협 코드·사업자등록번호·운영 상태는 Platform Admin만 변경할 수 있습니다.</p>
        <Actions pending={pending} canWrite={canWrite} />
      </div>
    </form>
  );
}

// ───────── 경매 정책 ─────────
type SlotDraft = { seq: string; label: string; bidStart: string; bidClose: string; autoNoticeAt: string };
function AuctionForm({ code, settings: s, locked, canWrite, species }: Common & { species: SpeciesOpt[] }) {
  const { save, pending, errors } = useSave(code, "auction");
  const [f, setF] = useState({
    digitalCloseBufferMin: String(s.digitalCloseBufferMin), tieBreakPolicy: s.tieBreakPolicy, digitalPriceVisibility: s.digitalPriceVisibility,
    bidModificationAllowed: s.bidModificationAllowed, fieldAuctionEnabled: s.fieldAuctionEnabled, bidMfaRequired: s.bidMfaRequired, winnerDisclosure: s.winnerDisclosure,
  });
  const [slots, setSlots] = useState<SlotDraft[]>(s.schedule.map((x) => ({ seq: String(x.seq), label: x.label, bidStart: x.bidStart, bidClose: x.bidClose, autoNoticeAt: x.autoNoticeAt ?? "" })));
  const [reserve, setReserve] = useState<Record<string, string>>(Object.fromEntries(species.map((sp) => [sp.code, s.reservePrices[sp.code] != null ? String(s.reservePrices[sp.code]) : ""])));
  const ro = !canWrite;
  const lk = ro || locked;

  const submit = () => {
    const reservePrices: Record<string, number> = {};
    for (const [k, v] of Object.entries(reserve)) if (v.trim() !== "") reservePrices[k] = Number(v);
    save({
      ...f, digitalCloseBufferMin: Number(f.digitalCloseBufferMin), reservePrices,
      schedule: slots.map((x) => ({ seq: Number(x.seq), label: x.label, bidStart: x.bidStart, bidClose: x.bidClose, autoNoticeAt: x.autoNoticeAt })),
    });
  };
  const upd = (i: number, k: keyof SlotDraft, v: string) => setSlots((arr) => arr.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const addSlot = () => setSlots((arr) => [...arr, { seq: String((arr.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0)) + 1), label: `${arr.length + 1}회차`, bidStart: "06:30", bidClose: "07:00", autoNoticeAt: "" }]);

  return (
    <form className="settings-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="panel">
        <div className="panel-header"><h2>입찰·개찰 정책</h2></div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label>디지털 마감 버퍼(분) *</label><input type="number" min={1} max={30} value={f.digitalCloseBufferMin} onChange={(e) => setF({ ...f, digitalCloseBufferMin: e.target.value })} required disabled={ro} /><div className="hint">디지털 마감 ~ 현장 경매 시작 사이 간격 (1~30)</div><Err m={errors.digitalCloseBufferMin} /></div>
            <div className="field"><label>동일가 처리 *<Lock on={locked} /></label>
              <select value={f.tieBreakPolicy} onChange={(e) => setF({ ...f, tieBreakPolicy: e.target.value as TieBreakPolicy })} disabled={lk}>
                {(["first_come", "lottery", "split", "rebid"] as const).map((k) => <option key={k} value={k}>{k} — {TIE_BREAK_LABEL[k]}</option>)}
              </select><Err m={errors.tieBreakPolicy} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label>디지털가 공개 *<Lock on={locked} /></label>
              <select value={f.digitalPriceVisibility} onChange={(e) => setF({ ...f, digitalPriceVisibility: e.target.value as DigitalPriceVisibility })} disabled={lk}>
                {(["hidden", "auctioneer_only", "public"] as const).map((k) => <option key={k} value={k}>{VISIBILITY_LABEL[k]}</option>)}
              </select><Err m={errors.digitalPriceVisibility} /></div>
            <div className="field"><label>낙찰자 공개 방식</label>
              <select value={f.winnerDisclosure} onChange={(e) => setF({ ...f, winnerDisclosure: e.target.value as WinnerDisclosure })} disabled={ro}>
                <option value="license_no">면허번호 공개</option><option value="anonymous">익명</option>
              </select></div>
          </div>
          <div className="checkbox-row" style={{ marginTop: 14 }}>
            <label><input type="checkbox" checked={f.bidModificationAllowed} onChange={(e) => setF({ ...f, bidModificationAllowed: e.target.checked })} disabled={lk} /> 입찰 수정 허용<Lock on={locked} /></label>
            <label><input type="checkbox" checked={f.fieldAuctionEnabled} onChange={(e) => setF({ ...f, fieldAuctionEnabled: e.target.checked })} disabled={ro} /> 현장 경매(호가식) 병행</label>
            <label><input type="checkbox" checked={f.bidMfaRequired} onChange={(e) => setF({ ...f, bidMfaRequired: e.target.checked })} disabled={ro} /> 입찰 시 강한 인증(OTP) 요구</label>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>회차별 운영 시간표</h2>{canWrite && <button type="button" className="btn-secondary" onClick={addSlot}>+ 회차 추가</button>}</div>
        <div className="panel-body dense">
          <div className="table-scroll">
            <table className="data-table schedule-table">
              <thead><tr><th style={{ width: 70 }}>회차</th><th>라벨</th><th style={{ width: 120 }}>입찰 시작</th><th style={{ width: 120 }}>입찰 마감</th><th style={{ width: 120 }}>자동 공지</th>{canWrite && <th style={{ width: 60 }}></th>}</tr></thead>
              <tbody>
                {slots.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>등록된 회차가 없습니다. 회차가 없으면 자동으로 경매 회차가 생성되지 않습니다.</td></tr>}
                {slots.map((x, i) => (
                  <tr key={i}>
                    <td><input type="number" min={1} value={x.seq} onChange={(e) => upd(i, "seq", e.target.value)} required disabled={ro} /></td>
                    <td><input value={x.label} onChange={(e) => upd(i, "label", e.target.value)} required disabled={ro} /></td>
                    <td><input type="time" value={x.bidStart} onChange={(e) => upd(i, "bidStart", e.target.value)} required disabled={ro} /></td>
                    <td><input type="time" value={x.bidClose} onChange={(e) => upd(i, "bidClose", e.target.value)} required disabled={ro} /></td>
                    <td><input type="time" value={x.autoNoticeAt} onChange={(e) => upd(i, "autoNoticeAt", e.target.value)} disabled={ro} /></td>
                    {canWrite && <td><button type="button" className="btn-ghost small" onClick={() => setSlots((arr) => arr.filter((_, j) => j !== i))}>삭제</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.schedule && <div className="field-error" style={{ padding: "8px 14px" }}>{errors.schedule}</div>}
          <p className="hint" style={{ padding: "8px 14px" }}>마감은 시작 이후여야 하며, 자동 공지 시각은 선택입니다. 변경은 다음 날 회차 생성부터 반영됩니다.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>어종별 최저가(예가)</h2><span className="muted small">비워두면 최저가 없음</span></div>
        <div className="panel-body dense">
          <div className="table-scroll">
            <table className="data-table units-table">
              <thead><tr><th>어종</th><th>기본 단위</th><th>최저 단가(원)</th></tr></thead>
              <tbody>
                {species.map((sp) => (
                  <tr key={sp.code}><td>{sp.name} <span className="muted small mono">{sp.code}</span></td><td>{sp.defaultUnit}</td>
                    <td><input type="number" min={1} step={1} value={reserve[sp.code] ?? ""} onChange={(e) => setReserve({ ...reserve, [sp.code]: e.target.value })} placeholder="-" disabled={ro} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.reservePrices && <div className="field-error" style={{ padding: "8px 14px" }}>{errors.reservePrices}</div>}
        </div>
      </div>
      <Actions pending={pending} canWrite={canWrite} />
    </form>
  );
}

// ───────── 단위 환산 ─────────
function UnitsForm({ code, settings: s, canWrite, species }: Common & { species: SpeciesOpt[] }) {
  const { save, pending, errors } = useSave(code, "units");
  const [tbl, setTbl] = useState<Record<string, { box: string; ea: string }>>(Object.fromEntries(species.map((sp) => [sp.code, { box: s.boxWeightTable[sp.code]?.box != null ? String(s.boxWeightTable[sp.code]?.box) : "", ea: s.boxWeightTable[sp.code]?.ea != null ? String(s.boxWeightTable[sp.code]?.ea) : "" }])));
  const ro = !canWrite;
  const submit = () => {
    const boxWeightTable: Record<string, { box?: number; ea?: number }> = {};
    for (const [k, v] of Object.entries(tbl)) {
      const e: { box?: number; ea?: number } = {};
      if (v.box.trim() !== "") e.box = Number(v.box);
      if (v.ea.trim() !== "") e.ea = Number(v.ea);
      if (e.box !== undefined || e.ea !== undefined) boxWeightTable[k] = e;
    }
    save({ boxWeightTable });
  };
  return (
    <form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="panel-header"><h2>어종별 표준 중량</h2><span className="muted small">입고 시 박스/마리 수량 ↔ kg 환산에 사용</span></div>
      <div className="panel-body dense">
        <div className="table-scroll">
          <table className="data-table units-table">
            <thead><tr><th>어종</th><th>기본 단위</th><th>박스당 kg</th><th>마리당 g</th></tr></thead>
            <tbody>
              {species.map((sp) => (
                <tr key={sp.code}>
                  <td>{sp.name} <span className="muted small mono">{sp.code}</span></td><td>{sp.defaultUnit}</td>
                  <td><input type="number" min={0.1} step={0.1} value={tbl[sp.code]?.box ?? ""} onChange={(e) => setTbl({ ...tbl, [sp.code]: { ...tbl[sp.code], ea: tbl[sp.code]?.ea ?? "", box: e.target.value } })} placeholder="-" disabled={ro} /></td>
                  <td><input type="number" min={1} step={1} value={tbl[sp.code]?.ea ?? ""} onChange={(e) => setTbl({ ...tbl, [sp.code]: { ...tbl[sp.code], box: tbl[sp.code]?.box ?? "", ea: e.target.value } })} placeholder="-" disabled={ro} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errors.boxWeightTable && <div className="field-error" style={{ padding: "8px 14px" }}>{errors.boxWeightTable}</div>}
        <div style={{ padding: "0 18px 18px" }}><Actions pending={pending} canWrite={canWrite} /></div>
      </div>
    </form>
  );
}

// ───────── 수수료 ─────────
const pctStr = (r: number) => String(Math.round(r * 1000) / 10);
function FeesForm({ code, settings: s, locked, canWrite }: Common) {
  const { save, pending, errors } = useSave(code, "fees");
  const [f, setF] = useState({ market: pctStr(s.feePolicy.marketFeeRate), broker: pctStr(s.feePolicy.brokerFeeRate), vatIncluded: s.feePolicy.vatIncluded, vat: pctStr(s.feePolicy.vatRate) });
  const lk = !canWrite || locked;
  const toRate = (p: string) => Math.round(Number(p) * 10) / 1000;
  const market = toRate(f.market), broker = toRate(f.broker), vat = toRate(f.vat);
  const gross = 1_000_000;
  const mFee = Math.round(gross * market), bFee = Math.round(gross * broker);
  const mVat = f.vatIncluded ? 0 : Math.round(mFee * vat), bVat = f.vatIncluded ? 0 : Math.round(bFee * vat);
  return (
    <form className="settings-form" onSubmit={(e) => { e.preventDefault(); save({ marketFeeRate: market, brokerFeeRate: broker, vatIncluded: f.vatIncluded, vatRate: vat }); }}>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header"><h2>수수료 정책</h2></div>
          <div className="panel-body">
            <div className="form-grid">
              <div className="field"><label>위판수수료율 (%) *<Lock on={locked} /></label><input type="number" min={0} max={10} step={0.1} value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })} required disabled={lk} /><div className="hint">0~10%, 0.1% 단위 · 선주 지급액에서 차감</div><Err m={errors.marketFeeRate} /></div>
              <div className="field"><label>중매인수수료율 (%) *<Lock on={locked} /></label><input type="number" min={0} max={5} step={0.1} value={f.broker} onChange={(e) => setF({ ...f, broker: e.target.value })} required disabled={lk} /><div className="hint">0~5%, 0.1% 단위 · 중매인 청구액에 가산</div><Err m={errors.brokerFeeRate} /></div>
              <div className="field"><label>VAT율 (%)</label><input type="number" min={0} max={20} step={0.1} value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} disabled={lk} /><Err m={errors.vatRate} /></div>
            </div>
            <div className="checkbox-row" style={{ marginTop: 14 }}>
              <label><input type="checkbox" checked={f.vatIncluded} onChange={(e) => setF({ ...f, vatIncluded: e.target.checked })} disabled={lk} /> 수수료에 VAT 포함<Lock on={locked} /></label>
            </div>
            <p className="hint">변경 시 중매인·운영자에게 자동 알림이 발송되며, 진행 중인 회차에는 적용되지 않습니다.</p>
            <Actions pending={pending} canWrite={canWrite} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>예시 계산 — {won(gross)} 낙찰 시</h2></div>
          <div className="panel-body">
            <div className="fee-example">
              <dl className="kv">
                <dt>위판수수료 ({f.market || 0}%)</dt><dd><b>{won(mFee)}</b>{mVat > 0 && <span className="muted"> + VAT {won(mVat)}</span>}</dd>
                <dt>선주 지급액</dt><dd><b className="text-success">{won(gross - mFee - mVat)}</b></dd>
                <dt>중매인수수료 ({f.broker || 0}%)</dt><dd><b>{won(bFee)}</b>{bVat > 0 && <span className="muted"> + VAT {won(bVat)}</span>}</dd>
                <dt>중매인 청구액</dt><dd><b>{won(gross + bFee + bVat)}</b></dd>
                <dt>수협 수수료 수입</dt><dd><b>{won(mFee + bFee)}</b> <span className="muted">(VAT {f.vatIncluded ? "포함" : "별도"})</span></dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

// ───────── 알림 ─────────
const CHANNELS: { key: NotificationChannel; label: string; fixed?: boolean }[] = [
  { key: "inapp", label: "인앱", fixed: true }, { key: "kakao", label: "카카오 알림톡" }, { key: "sms", label: "SMS" }, { key: "email", label: "이메일" },
];
function NotificationForm({ code, settings: s, canWrite }: Common) {
  const { save, pending, errors } = useSave(code, "notification");
  const [channels, setChannels] = useState<NotificationChannel[]>(s.notificationConfig.channels.includes("inapp") ? s.notificationConfig.channels : ["inapp", ...s.notificationConfig.channels]);
  const [f, setF] = useState({ kakaoSenderKey: s.notificationConfig.kakaoSenderKey ?? "", smsSenderNo: s.notificationConfig.smsSenderNo ?? "" });
  const ro = !canWrite;
  const toggle = (k: NotificationChannel, on: boolean) => setChannels((c) => (on ? [...new Set([...c, k])] : c.filter((x) => x !== k)));
  return (
    <form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); save({ notificationConfig: { channels, ...f } }); }}>
      <div className="panel-header"><h2>알림 채널</h2><span className="muted small">현재 외부 채널은 Mock(발송 로그만 기록)</span></div>
      <div className="panel-body">
        <label>사용 채널</label>
        <div className="checkbox-row">
          {CHANNELS.map((c) => <label key={c.key}><input type="checkbox" checked={channels.includes(c.key)} disabled={ro || c.fixed} onChange={(e) => toggle(c.key, e.target.checked)} /> {c.label}{c.fixed && <span className="muted small"> (필수)</span>}</label>)}
        </div>
        <Err m={errors.notificationConfig} />
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="field"><label>알림톡 발신 프로필 키</label><input value={f.kakaoSenderKey} onChange={(e) => setF({ ...f, kakaoSenderKey: e.target.value })} placeholder="카카오 비즈메시지 발신프로필 키" disabled={ro || !channels.includes("kakao")} /></div>
          <div className="field"><label>SMS 발신번호</label><input value={f.smsSenderNo} onChange={(e) => setF({ ...f, smsSenderNo: e.target.value })} placeholder="054-733-0001" disabled={ro || !channels.includes("sms")} /></div>
        </div>
        <p className="hint">낙찰·유찰·재입찰 등 필수 알림은 사용자 설정과 무관하게 발송됩니다. 수신자별 채널 선호는 각 사용자가 설정합니다.</p>
        <Actions pending={pending} canWrite={canWrite} />
      </div>
    </form>
  );
}

// ───────── 회계 연동 ─────────
function AccountingForm({ code, settings: s, canWrite }: Common) {
  const { save, pending, errors } = useSave(code, "accounting");
  const [adapter, setAdapter] = useState(s.accountingAdapter);
  return (
    <form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); save({ accountingAdapter: adapter }); }}>
      <div className="panel-header"><h2>회계 연동</h2></div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="field"><label>회계 어댑터</label>
            <select value={adapter} onChange={(e) => setAdapter(e.target.value)} disabled={!canWrite}>
              <option value="mock">Mock (정산 확정 시 로그만 기록)</option>
            </select><Err m={errors.accountingAdapter} /></div>
          <div className="field"><label>API Endpoint</label><input value="" placeholder="어댑터 연동 시 입력" disabled /></div>
          <div className="field"><label>API Key</label><input value="" placeholder="어댑터 연동 시 입력" disabled /></div>
        </div>
        <p className="hint">수협 회계 시스템(ERP) 어댑터는 추후 제공됩니다. Mock 상태에서는 정산서를 수동으로 출력해 처리하세요.</p>
        <Actions pending={pending} canWrite={canWrite} />
      </div>
    </form>
  );
}
