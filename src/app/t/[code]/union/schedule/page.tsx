import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { weekSchedule } from "@/services/union";
import { fmtTime, localDateStr, num } from "@/lib/format";

export const metadata = { title: "주간 일정" };
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** 해당 주의 월요일 (KST) */
function mondayOf(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return localDateStr(new Date(d.getTime() - dow * 86_400_000));
}

export default async function UnionSchedulePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(code, "union.schedule.read", { write: false });
  const start = isDate(sp.start) ? sp.start : mondayOf(localDateStr());
  const w = await weekSchedule(ctx.tenant, start);
  const end = w.days[6].date;
  const totals = w.days.reduce((s, d) => ({ rounds: s.rounds + d.rounds.length, lots: s.lots + d.rounds.reduce((x, r) => x + r.counts.lots, 0), kg: s.kg + d.rounds.reduce((x, r) => x + r.counts.weightKg, 0) }), { rounds: 0, lots: 0, kg: 0 });

  return (
    <>
      <div className="week-nav">
        <Link href={`/t/${code}/union/schedule?start=${w.prevStart}`}>‹ 이전 주</Link>
        <div className="title">{start.slice(5).replace("-", "/")} ~ {end.slice(5).replace("-", "/")}<div className="muted small" style={{ fontWeight: 400 }}>{totals.rounds}회차 · {totals.lots}품목 · {num(totals.kg)}kg</div></div>
        <Link href={`/t/${code}/union/schedule?start=${w.nextStart}`}>다음 주 ›</Link>
      </div>
      {start !== mondayOf(w.today) && <div className="text-right small mb-8"><Link href={`/t/${code}/union/schedule`}>이번 주로 →</Link></div>}

      <div className="cal-grid week">
        {w.days.map((d) => {
          const dow = new Date(`${d.date}T12:00:00+09:00`).getUTCDay();
          return (
            <div key={d.date} className={`cal-day${d.isToday ? " today" : ""}${dow === 0 || dow === 6 ? " weekend" : ""}`}>
              <div className="day-head"><div className="dow">{DOW[dow]}{d.isToday && " · 오늘"}</div><div className="day-num">{Number(d.date.slice(8))}일</div></div>
              <div className="day-items">
                {d.rounds.length === 0 && <div className="none">회차 없음</div>}
                {d.rounds.map((r) => (
                  <Link key={r.id} href={`/t/${code}/union/schedule/${r.id}`} className={`cal-item${r.status === "done" ? " done" : ""}${r.status === "cancelled" ? " cancelled" : ""}`} title={r.label}>
                    {r.seq}회차 {fmtTime(r.bidCloseAt)} 마감
                    <small>{r.counts.vessels}척 · {r.counts.lots}품목 · {num(r.counts.weightKg)}kg</small>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-title">이 주의 회차 목록</div>
      {totals.rounds === 0 && <div className="empty-state" style={{ padding: "24px 20px" }}><div className="emoji">🗓</div>등록된 회차가 없습니다</div>}
      {w.days.filter((d) => d.rounds.length).map((d) => (
        <div key={d.date}>
          {d.rounds.map((r) => (
            <Link key={r.id} href={`/t/${code}/union/schedule/${r.id}`} className="ship-item">
              <div className="row"><div className="vessel">{r.label}</div><span className="small muted">{fmtTime(r.bidStartAt)}~{fmtTime(r.bidCloseAt)}</span></div>
              <div className="sub"><span>선박 {r.counts.vessels}척</span><span>입고 {r.counts.intakes}건</span><span>{r.counts.lots}품목 · {num(r.counts.weightKg)}kg</span></div>
              {r.counts.species.length > 0 && <div className="species">{r.counts.species.slice(0, 6).map((s) => <span key={s.code}>{s.name}</span>)}</div>}
            </Link>
          ))}
        </div>
      ))}
      <div className="readonly-note mt-16">미래 회차의 입항 척수·어종은 입고가 등록되는 대로 갱신됩니다 (예상치 아님 — 실제 등록분).</div>
    </>
  );
}
