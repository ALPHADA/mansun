import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { platformStats, platformDailyAmounts } from "@/services/platform";
import { StatusBadge } from "@/components/Badge";
import { TENANT_STATUS } from "@/domain/status";
import { localDateStr, num, won, fmtShortDate } from "@/lib/format";

export const metadata = { title: "플랫폼 통계" };
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shift = (d: string, days: number) => localDateStr(new Date(new Date(`${d}T12:00:00+09:00`).getTime() + days * 86_400_000));

export default async function PlatformStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const today = localDateStr();
  const from = isDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.to) ? sp.to : today;
  const [rows, daily] = await Promise.all([platformStats(from, to), platformDailyAmounts(from, to)]);
  const active = rows.filter((r) => r.lots > 0 || r.status === "active");
  const maxAmount = Math.max(1, ...rows.map((r) => r.awardedAmount));
  const total = rows.reduce((s, r) => ({ lots: s.lots + r.lots, awardedLots: s.awardedLots + r.awardedLots, amount: s.amount + r.awardedAmount, rounds: s.rounds + r.rounds, brokers: s.brokers + r.brokersActive }), { lots: 0, awardedLots: 0, amount: 0, rounds: 0, brokers: 0 });
  const topAmount = [...rows].sort((a, b) => b.awardedAmount - a.awardedAmount).filter((r) => r.awardedAmount > 0).slice(0, 5);
  const topMembers = [...rows].sort((a, b) => b.activeMembers - a.activeMembers).slice(0, 5);

  // 일자별 합계 (전체 Tenant)
  const byDate = new Map<string, { amount: number; lots: number }>();
  for (const d of daily) { const c = byDate.get(d.date) ?? { amount: 0, lots: 0 }; c.amount += d.amount; c.lots += d.lots; byDate.set(d.date, c); }
  const dates = [...byDate.keys()].sort();
  const maxDaily = Math.max(1, ...dates.map((d) => byDate.get(d)!.amount));

  const ranges = [
    { label: "오늘", from: today, to: today }, { label: "7일", from: shift(today, -6), to: today },
    { label: "이번 달", from: `${today.slice(0, 7)}-01`, to: today }, { label: "30일", from: shift(today, -29), to: today }, { label: "90일", from: shift(today, -89), to: today },
  ];
  const csvHref = `/platform/stats/export?from=${from}&to=${to}`;

  return (
    <>
      <div className="pf-head">
        <div><h2>플랫폼 통계</h2><div className="sub">Tenant 간 비교 · {from} ~ {to} · 회차 일자 기준</div></div>
        <div className="actions"><a href={csvHref} className="btn-secondary">⬇ CSV 내보내기</a></div>
      </div>

      <div className="panel">
        <form className="filter-bar" method="get">
          <div className="field"><label>시작일</label><input type="date" name="from" defaultValue={from} max={to} /></div>
          <div className="field"><label>종료일</label><input type="date" name="to" defaultValue={to} min={from} /></div>
          <div className="actions"><button className="btn-secondary" type="submit">조회</button></div>
          <div className="field grow">
            <label>빠른 선택</label>
            <div className="quick-range">{ranges.map((r) => <Link key={r.label} href={`/platform/stats?from=${r.from}&to=${r.to}`} className={r.from === from && r.to === to ? "active" : undefined}>{r.label}</Link>)}</div>
          </div>
        </form>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">거래(로트)</div><div className="kpi-value">{num(total.lots)}</div><div className="kpi-sub">낙찰 {num(total.awardedLots)} · {total.lots ? num((total.awardedLots / total.lots) * 100, 1) : 0}%</div></div>
        <div className="kpi-card"><div className="kpi-label">낙찰 금액</div><div className="kpi-value">{won(total.amount)}</div><div className="kpi-sub">낙찰가 × 수량</div></div>
        <div className="kpi-card"><div className="kpi-label">회차</div><div className="kpi-value">{num(total.rounds)}</div><div className="kpi-sub">{total.rounds ? `회차당 ${num(total.lots / total.rounds, 1)}로트` : "-"}</div></div>
        <div className="kpi-card"><div className="kpi-label">활성 중매인 (현재)</div><div className="kpi-value">{num(total.brokers)}</div><div className="kpi-sub">{active.length}개 수협</div></div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="panel">
          <div className="panel-header"><h2>수협별 낙찰 금액</h2></div>
          <div className="panel-body">
            {rows.every((r) => r.awardedAmount === 0) ? <div className="muted small">기간 내 낙찰 데이터가 없습니다</div> : (
              <div className="stat-bars">
                {[...rows].sort((a, b) => b.awardedAmount - a.awardedAmount).map((r) => (
                  <div key={r.tenantId} className="stat-bar">
                    <div><Link href={`/platform/tenants/${r.code}`}>{r.name}</Link></div>
                    <div className="track"><div className={`fill${r.awardedAmount === 0 ? " muted" : ""}`} style={{ width: `${Math.max(1, (r.awardedAmount / maxAmount) * 100)}%` }} /></div>
                    <div className="val">{won(r.awardedAmount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>일자별 낙찰 금액 (전체)</h2><span className="muted small">{dates.length}일</span></div>
          <div className="panel-body">
            {dates.length === 0 ? <div className="muted small">데이터가 없습니다</div> : (
              <>
                <div className="bar-chart">
                  {dates.map((d) => { const c = byDate.get(d)!; return <div key={d} className="bar-col" title={`${d} · ${c.lots}로트 · ${won(c.amount)}`}><div className="bar" style={{ height: `${Math.max(2, (c.amount / maxDaily) * 100)}%` }} /></div>; })}
                </div>
                <div className="bar-labels">{dates.map((d) => <span key={d}>{fmtShortDate(d)}</span>)}</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>수협별 상세</h2><span className="muted small">{rows.length}개 수협</span></div>
        <div className="panel-body dense">
          <table className="data-table">
            <thead><tr><th>수협</th><th>상태</th><th className="num">회차</th><th className="num">로트</th><th className="num">낙찰</th><th className="num">낙찰률</th><th className="num">낙찰 금액</th><th className="num">평균 단가</th><th className="num">회차당 로트</th><th className="num">활성 중매인</th><th className="num">활성 멤버</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId}>
                  <td><Link href={`/platform/tenants/${r.code}`}>{r.name}</Link> <span className="muted small">{r.code}</span></td>
                  <td><StatusBadge map={TENANT_STATUS} value={r.status} /></td>
                  <td className="num">{num(r.rounds)}</td>
                  <td className="num">{num(r.lots)}</td>
                  <td className="num">{num(r.awardedLots)}</td>
                  <td className="num">{r.lots ? `${num((r.awardedLots / r.lots) * 100, 1)}%` : "-"}</td>
                  <td className="num">{won(r.awardedAmount)}</td>
                  <td className="num">{r.avgUnitPrice ? won(r.avgUnitPrice) : "-"}</td>
                  <td className="num">{r.rounds ? num(r.avgLotsPerRound, 1) : "-"}</td>
                  <td className="num">{num(r.brokersActive)}</td>
                  <td className="num">{num(r.activeMembers)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, background: "#f9fafb" }}>
                <td colSpan={2}>합계</td><td className="num">{num(total.rounds)}</td><td className="num">{num(total.lots)}</td><td className="num">{num(total.awardedLots)}</td>
                <td className="num">{total.lots ? `${num((total.awardedLots / total.lots) * 100, 1)}%` : "-"}</td><td className="num">{won(total.amount)}</td><td className="num">-</td><td className="num">-</td><td className="num">{num(total.brokers)}</td><td className="num">{num(rows.reduce((s, r) => s + r.activeMembers, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="stats-grid">
        <div className="panel">
          <div className="panel-header"><h2>Top 거래액</h2></div>
          <div className="panel-body dense">
            <table className="data-table"><tbody>
              {topAmount.map((r, i) => <tr key={r.tenantId}><td style={{ width: 30 }} className="muted">{i + 1}</td><td><Link href={`/platform/tenants/${r.code}`}>{r.name}</Link></td><td className="num">{won(r.awardedAmount)}</td></tr>)}
              {topAmount.length === 0 && <tr><td className="muted" style={{ textAlign: "center", padding: 20 }}>데이터 없음</td></tr>}
            </tbody></table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>Top 활성 사용자</h2></div>
          <div className="panel-body dense">
            <table className="data-table"><tbody>
              {topMembers.map((r, i) => <tr key={r.tenantId}><td style={{ width: 30 }} className="muted">{i + 1}</td><td><Link href={`/platform/tenants/${r.code}`}>{r.name}</Link></td><td className="num">{num(r.activeMembers)}명 <span className="muted small">(중매인 {r.brokersActive})</span></td></tr>)}
            </tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}
