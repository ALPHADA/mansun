import Link from "next/link";
import { requireTenantContext, hasPermission } from "@/lib/auth/context";
import { listIntakes } from "@/services/intake";
import { listRounds } from "@/services/round";
import { StatusBadge } from "@/components/Badge";
import { Countdown } from "@/components/Countdown";
import { INTAKE_STATUS, ROUND_STATUS } from "@/domain/status";
import { fmtTime, localDateStr, num } from "@/lib/format";
import { OfflineQueueBadge } from "./OfflineQueueBadge";

export const metadata = { title: "입고" };

export default async function ReceiverHome({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  const canWrite = !ctx.readOnly && hasPermission(ctx, "intake.write");
  const today = localDateStr();
  const [rows, rounds] = await Promise.all([listIntakes(ctx.tenant.id, { date: today }), listRounds(ctx.tenant.id, { from: today, to: today })]);
  const now = Date.now();
  const current = rounds.find((r) => r.status !== "cancelled" && r.status !== "done" && r.bidCloseAt.getTime() > now) ?? null;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const totalWeight = rows.reduce((s, r) => s + r.totalWeight, 0);

  return (
    <>
      <div className="live-banner stack">
        <div className="label">📥 오늘 입고 · {today}</div>
        {current ? (
          <>
            <div className="timer-line">{current.label} <span className="badge badge-info" style={{ fontSize: 11 }}>{ROUND_STATUS[current.status].label}</span></div>
            <div className="sub">입찰 마감까지 <Countdown until={current.bidCloseAt.toISOString()} className="timer" /> <span style={{ marginLeft: 6 }}>· 마감 전 확정된 입고만 이 회차에 묶입니다</span></div>
          </>
        ) : (
          <div className="sub">오늘 남은 회차가 없습니다 — 신규 입고는 다음 회차로 등록됩니다</div>
        )}
      </div>

      <div className="flex space-between mb-8">
        <OfflineQueueBadge code={code} />
        {!canWrite && <span className="readonly-note" style={{ margin: 0, padding: "4px 10px" }}>읽기 전용</span>}
      </div>

      <div className="kpi-mini">
        <div className="cell"><div className="k">오늘 건수</div><div className="v">{rows.length}</div></div>
        <div className="cell"><div className="k">총 중량</div><div className="v">{num(totalWeight)}<span className="small muted">kg</span></div></div>
        <div className="cell"><div className="k">미확정</div><div className="v" style={drafts ? { color: "var(--color-warning)" } : undefined}>{drafts}</div></div>
      </div>

      {rows.length === 0 && (
        <div className="empty-state"><div className="emoji">🚢</div>오늘 등록된 입고가 없습니다{canWrite && <div className="small mt-8">우측 하단 + 버튼으로 새 입고를 등록하세요</div>}</div>
      )}
      {rows.map((r) => (
        <Link key={r.id} href={`/t/${code}/receiver/intake/${r.id}`} className="intake-item">
          <div className="row">
            <div className="vessel">{r.vesselName} <span className="small muted">· {r.shipperName ?? "선주 미지정"}</span></div>
            <StatusBadge map={INTAKE_STATUS} value={r.status} />
          </div>
          <div className="sub">
            <span>도착 {fmtTime(r.arrivedAt)}</span>
            <span>품목 {r.lotCount}개</span>
            <span>{num(r.totalWeight)}kg</span>
            <span>{r.roundLabel ?? "회차 미지정"}</span>
          </div>
        </Link>
      ))}

      {canWrite && <Link href={`/t/${code}/receiver/new`} className="fab" aria-label="새 입고">+</Link>}
    </>
  );
}
