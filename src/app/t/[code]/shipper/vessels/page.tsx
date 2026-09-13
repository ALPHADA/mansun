import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { myVessels, myIntakes } from "@/services/shipper";
import { listSpecies } from "@/services/species";
import { StatusBadge, Badge } from "@/components/Badge";
import { INTAKE_STATUS } from "@/domain/status";
import { fmtDate, fmtTime, localDateStr, num } from "@/lib/format";

export const metadata = { title: "선박별 출하 이력" };
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shift = (d: string, days: number) => localDateStr(new Date(new Date(`${d}T12:00:00+09:00`).getTime() + days * 86_400_000));

export default async function ShipperVesselsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(code, "shipper.read_self", { write: false });
  const today = localDateStr();
  const from = isDate(sp.from) ? sp.from : shift(today, -29);
  const to = isDate(sp.to) ? sp.to : today;
  const species = sp.species || undefined;
  const vesselId = sp.vessel || undefined;
  const [vessels, intakes, speciesList] = await Promise.all([myVessels(ctx), myIntakes(ctx, { from, to, species }), listSpecies()]);
  const history = vesselId ? intakes.filter((i) => i.vesselId === vesselId) : intakes;
  const byDate = new Map<string, typeof history>();
  for (const i of history) { const d = fmtDate(i.arrivedAt); byDate.set(d, [...(byDate.get(d) ?? []), i]); }
  const ranges = [{ label: "오늘", f: today, t: today }, { label: "7일", f: shift(today, -6), t: today }, { label: "30일", f: shift(today, -29), t: today }, { label: "90일", f: shift(today, -89), t: today }];
  const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ from, to, species, vessel: vesselId, ...o })) if (v) p.set(k, v); return `/t/${code}/shipper/vessels?${p}`; };

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>본인 명의 선박 ({vessels.length})</div>
      {vessels.length === 0 && <div className="empty-state" style={{ padding: "30px 20px" }}><div className="emoji">⚓</div>등록된 선박이 없습니다</div>}
      {vessels.map((v) => (
        <div key={v.id} className="vessel-card" style={vesselId === v.id ? { borderColor: "var(--color-accent)" } : undefined}>
          <div className="head">
            <div><div className="name">⚓ {v.name} {!v.active && <Badge tone="muted">비활성</Badge>}</div><div className="reg">등록번호 {v.registrationNo ?? "-"}</div></div>
            <Link href={vesselId === v.id ? qs({ vessel: undefined }) : qs({ vessel: v.id })} className="btn-secondary small" style={{ padding: "6px 10px" }}>{vesselId === v.id ? "전체 보기" : "이 선박만"}</Link>
          </div>
          <div className="stats">
            <div><div className="k">최근 출하</div><div className="v" style={{ fontSize: 13 }}>{v.lastArrivedAt ? fmtDate(v.lastArrivedAt) : "-"}</div></div>
            <div><div className="k">누적 출하</div><div className="v">{v.intakeCount}건</div></div>
            <div><div className="k">누적 품목 / 중량</div><div className="v" style={{ fontSize: 13 }}>{v.lotCount}품목 · {num(v.weightKg)}kg</div></div>
          </div>
        </div>
      ))}
      <div className="readonly-note">선박 등록·소유권 변경·등록번호 수정은 <b>수협 관리자</b>에게 요청하세요. (선주 화면에서는 조회만 가능)</div>

      <div className="section-title flex space-between"><span>출하 이력 {vesselId ? `· ${vessels.find((v) => v.id === vesselId)?.name ?? ""}` : ""}</span><a href={`/t/${code}/shipper/settlement/export?from=${from}&to=${to}`} className="small">CSV ⬇</a></div>
      <div className="quick-range">{ranges.map((r) => <Link key={r.label} href={qs({ from: r.f, to: r.t })} className={r.f === from && r.t === to ? "active" : undefined}>{r.label}</Link>)}</div>
      <form className="period-form" method="get">
        {vesselId && <input type="hidden" name="vessel" value={vesselId} />}
        <div><label>시작일</label><input type="date" name="from" defaultValue={from} /></div>
        <div><label>종료일</label><input type="date" name="to" defaultValue={to} /></div>
        <button className="btn-secondary" type="submit">조회</button>
        <div style={{ gridColumn: "1 / -1" }}><label>어종</label>
          <select name="species" defaultValue={species ?? ""}><option value="">전체 어종</option>{speciesList.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
        </div>
      </form>

      {history.length === 0 && <div className="empty-state" style={{ padding: "30px 20px" }}><div className="emoji">📭</div>{from} ~ {to} 출하 이력이 없습니다</div>}
      {[...byDate.entries()].map(([date, list]) => (
        <div key={date}>
          <div className="section-title" style={{ margin: "12px 0 6px" }}>{date} · {list.length}건 · {num(list.reduce((s, i) => s + i.totalWeight, 0))}kg</div>
          {list.map((i) => (
            <Link key={i.id} href={`/t/${code}/shipper/intake/${i.id}`} className="ship-item">
              <div className="row"><div className="vessel">🚢 {i.vesselName}</div><StatusBadge map={INTAKE_STATUS} value={i.status} /></div>
              <div className="sub"><span>도착 {fmtTime(i.arrivedAt)}</span><span>{i.roundLabel ?? "회차 미배정"}</span><span>{i.lotCount}품목 · {num(i.totalWeight)}kg</span></div>
            </Link>
          ))}
        </div>
      ))}
      <div className="small muted mt-8">낙찰가·지급액은 출하 상세 또는 <Link href={`/t/${code}/shipper/settlement?from=${from}&to=${to}`}>정산 내역</Link>에서 확인하세요.</div>
    </>
  );
}
