import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { workVolume } from "@/services/union";
import { fmtShortDate, localDateStr, num } from "@/lib/format";

export const metadata = { title: "작업량 통계" };
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shift = (d: string, days: number) => localDateStr(new Date(new Date(`${d}T12:00:00+09:00`).getTime() + days * 86_400_000));

export default async function UnionStatsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(code, "union.stats.read", { write: false });
  const today = localDateStr();
  const from = isDate(sp.from) ? sp.from : shift(today, -6);
  const to = isDate(sp.to) ? sp.to : today;
  const d = await workVolume(ctx, from, to);
  const maxKg = Math.max(1, ...d.days.map((x) => x.weightKg));
  const maxHour = Math.max(1, ...d.hours.map((h) => h.intakes));
  const hourMap = new Map(d.hours.map((h) => [h.hour, h.intakes]));
  const ranges = [{ label: "오늘", f: today, t: today }, { label: "7일", f: shift(today, -6), t: today }, { label: "이번 달", f: `${today.slice(0, 7)}-01`, t: today }, { label: "30일", f: shift(today, -29), t: today }];
  const level = (n: number) => n === 0 ? "" : n >= maxHour * 0.66 ? " l3" : n >= maxHour * 0.33 ? " l2" : " l1";

  return (
    <>
      <div className="flex space-between mb-8">
        <div><div style={{ fontWeight: 600 }}>작업량 통계</div><div className="muted small">{from} ~ {to}</div></div>
        {d.squadCode ? <span className="squad-badge">👷 작업조 {d.squadCode}</span> : <span className="muted small">작업조 미배정</span>}
      </div>
      <div className="quick-range">{ranges.map((r) => <Link key={r.label} href={`/t/${code}/union/stats?from=${r.f}&to=${r.t}`} className={r.f === from && r.t === to ? "active" : undefined}>{r.label}</Link>)}</div>
      <form className="period-form" method="get">
        <div><label>시작일</label><input type="date" name="from" defaultValue={from} /></div>
        <div><label>종료일</label><input type="date" name="to" defaultValue={to} /></div>
        <button className="btn-secondary" type="submit">조회</button>
      </form>

      <div className="hero-card">
        <div className="hero-label">기간 처리 중량 {d.squadCode ? `· ${d.squadCode}` : ""}</div>
        <div className="hero-value">{num(d.totals.weightKg)}kg</div>
        <div className="hero-grid">
          <div><div className="k">총 회차</div><div className="v">{d.totals.rounds}</div></div>
          <div><div className="k">입고</div><div className="v">{d.totals.intakes}건</div></div>
          <div><div className="k">품목</div><div className="v">{d.totals.lots}</div></div>
        </div>
      </div>
      <div className="readonly-note">작업조 모델이 도입되기 전이므로 수협 전체 처리량을 표시합니다. 작업조별 배정 데이터가 연결되면 본인 소속 작업조({d.squadCode ?? "미배정"}) 기준으로 필터링됩니다.</div>

      <div className="section-title">일자별 처리 중량</div>
      <div className="detail-section">
        {d.days.length === 0 ? <div className="muted small">기간 내 회차가 없습니다</div> : (
          <>
            <div className="vbar-chart">
              {d.days.map((x) => <div key={x.date} className="col" title={`${x.date} · ${x.rounds}회차 · ${x.intakes}입고 · ${num(x.weightKg)}kg`}><div className="bar" style={{ height: `${Math.max(2, (x.weightKg / maxKg) * 100)}%` }} /></div>)}
            </div>
            <div className="vbar-labels">{d.days.map((x) => <span key={x.date}>{fmtShortDate(x.date)}</span>)}</div>
          </>
        )}
      </div>
      {d.days.length > 0 && (
        <div className="detail-section" style={{ padding: 0, overflowX: "auto" }}>
          <table className="mini-table">
            <thead><tr><th>일자</th><th className="num">회차</th><th className="num">입고</th><th className="num">품목</th><th className="num">중량(kg)</th></tr></thead>
            <tbody>{d.days.map((x) => <tr key={x.date}><td>{x.date}</td><td className="num">{x.rounds}</td><td className="num">{x.intakes}</td><td className="num">{x.lots}</td><td className="num">{num(x.weightKg)}</td></tr>)}</tbody>
            <tfoot><tr><td>합계</td><td className="num">{d.totals.rounds}</td><td className="num">{d.totals.intakes}</td><td className="num">{d.totals.lots}</td><td className="num">{num(d.totals.weightKg)}</td></tr></tfoot>
          </table>
        </div>
      )}

      <div className="section-title">어종별 처리 비중</div>
      <div className="detail-section">
        {d.species.length === 0 && <div className="muted small">데이터 없음</div>}
        {d.species.slice(0, 10).map((s) => (
          <div key={s.code} className="share-row">
            <div>{s.name}</div>
            <div className="track"><div className="fill" style={{ width: `${Math.max(1, s.share * 100)}%` }} /></div>
            <div className="pct">{num(s.weightKg)}kg<br /><span className="small">{num(s.share * 100, 1)}%</span></div>
          </div>
        ))}
      </div>

      <div className="section-title">시간대별 입항 분포 <span className="muted" style={{ fontWeight: 400 }}>— 운반 패턴</span></div>
      <div className="detail-section">
        {d.hours.length === 0 ? <div className="muted small">데이터 없음</div> : (
          <>
            <div className="hour-grid">{Array.from({ length: 24 }, (_, h) => <div key={h} className={level(hourMap.get(h) ?? 0)} title={`${h}시 · ${hourMap.get(h) ?? 0}건`}>{h}</div>)}</div>
            <div className="muted small mt-8">숫자는 시(時), 진할수록 입항 건수가 많습니다 · 최다 {[...d.hours].sort((a, b) => b.intakes - a.intakes)[0]?.hour}시 ({maxHour}건)</div>
          </>
        )}
      </div>
    </>
  );
}
