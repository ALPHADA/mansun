import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { dailyCatch, monthlyCatch, speciesSummary, brokerShare, shipperPerformance, speciesPriceTrend, periodTotals, kpiToday } from "@/services/stats";
import { listSpecies } from "@/services/species";
import { fmtShortDate, localDateStr, num, unitLabel, won } from "@/lib/format";

export const metadata = { title: "통계/리포트" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const kstDate = (offsetDays: number) => localDateStr(new Date(Date.now() + offsetDays * 86_400_000));
const fmtKg = (kg: number) => (kg >= 1000 ? `${num(kg / 1000, 1)}t` : `${num(kg)}kg`);
const wonShort = (n: number) => (n >= 1e8 ? `${num(n / 1e8, 1)}억` : n >= 1e4 ? `${num(n / 1e4)}만` : num(n));

function BarChart({ data, valueKey, label, alt }: { data: { date: string; lots: number; weightKg: number; amount: number }[]; valueKey: "amount" | "weightKg" | "lots"; label: (v: number) => string; alt?: boolean }) {
  if (data.length === 0) return <div className="empty-state" style={{ padding: 28 }}>기간 내 낙찰 데이터가 없습니다</div>;
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  const showEvery = Math.max(1, Math.ceil(data.length / 12));
  return (
    <div>
      <div className="bar-chart">
        {data.map((d) => <div key={d.date} className="bar-col" title={`${d.date} · ${label(d[valueKey])}`}><div className={`bar${alt ? " alt" : ""}`} style={{ height: `${Math.max(2, (d[valueKey] / max) * 100)}%` }} /></div>)}
      </div>
      <div className="bar-labels">{data.map((d, i) => <span key={d.date}>{i % showEvery === 0 ? (d.date.length === 7 ? d.date.slice(2) : fmtShortDate(`${d.date}T00:00:00+09:00`)) : ""}</span>)}</div>
    </div>
  );
}
function HBar({ ratio, text }: { ratio: number; text: string }) {
  return <div className="hbar"><div className="track"><div className="fill" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} /></div><span className="pct">{text}</span></div>;
}

export default async function StatsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "stats.read")) notFound();
  const today = kstDate(0);
  let from = sp.from && DATE.test(sp.from) ? sp.from : kstDate(-29);
  let to = sp.to && DATE.test(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];
  const spanDays = Math.round((new Date(`${to}T00:00:00+09:00`).getTime() - new Date(`${from}T00:00:00+09:00`).getTime()) / 86_400_000) + 1;
  const monthly = spanDays > 92;
  const species = await listSpecies();
  const speciesCode = species.some((s) => s.code === sp.species) ? (sp.species as string) : species[0]?.code;
  const trendDays = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const tid = ctx.tenant.id;
  const [totals, kToday, series, bySpecies, brokers, shippers, trend] = await Promise.all([
    periodTotals(tid, from, to), kpiToday(tid), monthly ? monthlyCatch(tid, from, to) : dailyCatch(tid, from, to),
    speciesSummary(tid, from, to), brokerShare(tid, from, to), shipperPerformance(tid, from, to),
    speciesCode ? speciesPriceTrend(tid, speciesCode, trendDays) : Promise.resolve([]),
  ]);
  const maxSpecies = Math.max(...bySpecies.map((s) => s.amount), 1);
  const maxShipper = Math.max(...shippers.map((s) => s.amount), 1);
  const maxTrend = Math.max(...trend.map((t) => t.avgPrice), 1);
  const quick = (d: number, label: string) => <Link key={label} href={`/t/${code}/admin/stats?from=${kstDate(-d + 1)}&to=${today}`} className={`chip${from === kstDate(-d + 1) && to === today ? " active" : ""}`}>{label}</Link>;
  const base = `/t/${code}/admin/stats?from=${from}&to=${to}`;

  return (
    <>
      <div className="panel">
        <form className="filter-bar" method="get">
          <div className="field"><label>시작일</label><input type="date" name="from" defaultValue={from} max={today} /></div>
          <div className="field"><label>종료일</label><input type="date" name="to" defaultValue={to} max={today} /></div>
          <div className="actions"><button type="submit" className="btn-secondary">조회</button></div>
          <div className="chips" style={{ margin: 0, alignSelf: "center" }}>{quick(7, "최근 7일")}{quick(30, "최근 30일")}{quick(90, "최근 90일")}{quick(365, "최근 1년")}</div>
        </form>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">기간 낙찰 건수</div><div className="kpi-value">{num(totals.lots)}<span className="muted" style={{ fontSize: 14 }}>건</span></div><div className="kpi-sub">{from} ~ {to} ({totals.days}일 거래)</div></div>
        <div className="kpi-card"><div className="kpi-label">기간 낙찰 금액</div><div className="kpi-value">{wonShort(totals.amount)}<span className="muted" style={{ fontSize: 14 }}>원</span></div><div className="kpi-sub">{won(totals.amount)}</div></div>
        <div className="kpi-card"><div className="kpi-label">기간 어획량</div><div className="kpi-value">{fmtKg(totals.weightKg)}</div><div className="kpi-sub">낙찰 중매인 {totals.brokers}명</div></div>
        <div className="kpi-card"><div className="kpi-label">오늘 ({kToday.date})</div><div className="kpi-value">{num(kToday.awarded)}<span className="muted" style={{ fontSize: 14 }}> / {kToday.lots}건</span></div><div className="kpi-sub">{won(kToday.amount)} · 유찰 {kToday.passed} · 평균 입찰 {num(kToday.avgBidCount, 1)}건</div></div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="panel">
          <div className="panel-header"><h2>{monthly ? "월별" : "일별"} 낙찰 금액</h2><span className="muted small">{series.length}{monthly ? "개월" : "일"}</span></div>
          <div className="panel-body"><BarChart data={series} valueKey="amount" label={won} /></div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>{monthly ? "월별" : "일별"} 어획량</h2><span className="muted small">kg</span></div>
          <div className="panel-body"><BarChart data={series} valueKey="weightKg" label={fmtKg} alt /></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>{monthly ? "월별" : "일별"} 어획량 / 금액</h2></div>
        <div className="panel-body dense">
          {series.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>데이터 없음</div> : (
            <div className="table-scroll"><table className="data-table">
              <thead><tr><th>{monthly ? "월" : "일자"}</th><th className="num">낙찰 건수</th><th className="num">어획량</th><th className="num">낙찰 금액</th><th className="num">건당 평균</th></tr></thead>
              <tbody>
                {[...series].reverse().map((d) => <tr key={d.date}><td className="mono">{d.date}</td><td className="num">{num(d.lots)}</td><td className="num">{fmtKg(d.weightKg)}</td><td className="num">{won(d.amount)}</td><td className="num">{won(d.lots ? d.amount / d.lots : 0)}</td></tr>)}
                <tr style={{ fontWeight: 600, background: "#f9fafb" }}><td>합계</td><td className="num">{num(totals.lots)}</td><td className="num">{fmtKg(totals.weightKg)}</td><td className="num">{won(totals.amount)}</td><td className="num">{won(totals.lots ? totals.amount / totals.lots : 0)}</td></tr>
              </tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="panel">
          <div className="panel-header"><h2>어종별 요약</h2></div>
          <div className="panel-body dense">
            {bySpecies.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>데이터 없음</div> : (
              <div className="table-scroll"><table className="data-table">
                <thead><tr><th>어종</th><th className="num">건수</th><th className="num">어획량</th><th className="num">평균 단가</th><th>낙찰 금액</th></tr></thead>
                <tbody>
                  {bySpecies.map((s) => <tr key={s.speciesCode}><td><Link href={`${base}&species=${s.speciesCode}&days=${trendDays}#trend`}>{s.name}</Link></td><td className="num">{num(s.lots)}</td><td className="num">{fmtKg(s.weightKg)}</td><td className="num">{won(s.avgPrice)}/{unitLabel(s.unit)}</td><td><HBar ratio={s.amount / maxSpecies} text={wonShort(s.amount)} /></td></tr>)}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>중매인 낙찰 점유율</h2><span className="muted small">금액 기준</span></div>
          <div className="panel-body dense">
            {brokers.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>데이터 없음</div> : (
              <div className="table-scroll"><table className="data-table">
                <thead><tr><th>중매인</th><th>면허</th><th className="num">건수</th><th className="num">낙찰 금액</th><th>점유율</th></tr></thead>
                <tbody>
                  {brokers.map((b) => <tr key={b.membershipId}><td>{b.name}</td><td className="mono small">{b.licenseNo ?? "-"}</td><td className="num">{num(b.lots)}</td><td className="num">{won(b.amount)}</td><td><HBar ratio={b.share} text={`${num(b.share * 100, 1)}%`} /></td></tr>)}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="panel">
          <div className="panel-header"><h2>선주별 출하 실적</h2></div>
          <div className="panel-body dense">
            {shippers.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>데이터 없음</div> : (
              <div className="table-scroll"><table className="data-table">
                <thead><tr><th>선주</th><th className="num">선박</th><th className="num">건수</th><th className="num">어획량</th><th>낙찰 금액</th></tr></thead>
                <tbody>
                  {shippers.map((s) => <tr key={s.userId || s.name}><td>{s.name}</td><td className="num">{s.vessels}척</td><td className="num">{num(s.lots)}</td><td className="num">{fmtKg(s.weightKg)}</td><td><HBar ratio={s.amount / maxShipper} text={wonShort(s.amount)} /></td></tr>)}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
        <div className="panel" id="trend">
          <div className="panel-header">
            <h2>어종 단가 추이</h2>
            <form method="get" className="flex">
              <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
              <select name="species" defaultValue={speciesCode} style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}>{species.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
              <select name="days" defaultValue={String(trendDays)} style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}><option value="7">7일</option><option value="30">30일</option><option value="90">90일</option></select>
              <button type="submit" className="btn-secondary" style={{ padding: "5px 10px", fontSize: 13 }}>조회</button>
            </form>
          </div>
          <div className="panel-body">
            {trend.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>최근 {trendDays}일 낙찰 데이터가 없습니다</div> : (
              <>
                <div className="bar-chart" style={{ height: 120 }}>
                  {trend.map((t) => <div key={t.date} className="bar-col" title={`${t.date} · ${won(t.avgPrice)}/${unitLabel(t.unit)} (${t.lots}건)`}><div className="bar" style={{ height: `${Math.max(2, (t.avgPrice / maxTrend) * 100)}%` }} /></div>)}
                </div>
                <div className="bar-labels">{trend.map((t, i) => <span key={t.date}>{i % Math.max(1, Math.ceil(trend.length / 10)) === 0 ? fmtShortDate(`${t.date}T00:00:00+09:00`) : ""}</span>)}</div>
                <div className="table-scroll" style={{ marginTop: 12 }}><table className="data-table">
                  <thead><tr><th>일자</th><th className="num">건수</th><th className="num">평균 단가</th></tr></thead>
                  <tbody>{[...trend].reverse().slice(0, 15).map((t) => <tr key={t.date}><td className="mono">{t.date}</td><td className="num">{t.lots}</td><td className="num">{won(t.avgPrice)}/{unitLabel(t.unit)}</td></tr>)}</tbody>
                </table></div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
