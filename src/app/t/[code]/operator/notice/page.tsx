import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { listAuctions } from "@/services/auction";
import { defaultMessage, listNotices, recipientCounts, CHANNEL_LABEL, TARGET_LABEL } from "@/services/notice";
import { listRoundsWithCounts } from "@/services/dashboard";
import { Badge, StatusBadge } from "@/components/Badge";
import { AUCTION_STATUS, ROUND_STATUS } from "@/domain/status";
import { fmtDateTime, fmtTime, localDateStr, num, toLocalInput, unitLabel } from "@/lib/format";
import { PageTitle } from "../_components/PageTitle";
import { RoundSelect } from "../_components/RoundSelect";
import { NoticeForm } from "./NoticeForm";

export const metadata = { title: "경매 공지" };

export default async function NoticePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext(code);
  const tenant = ctx.tenant;
  const today = localDateStr();

  const rounds = (await listRoundsWithCounts(tenant.id, { from: today, limit: 20 }))
    .filter((r) => r.round.status !== "cancelled")
    .sort((a, b) => a.round.bidCloseAt.getTime() - b.round.bidCloseAt.getTime());
  const selectable = rounds.filter((r) => r.round.status !== "done");
  const selected = rounds.find((r) => r.round.id === sp.round) ?? selectable.find((r) => r.lotCount > 0) ?? selectable[0] ?? rounds[0] ?? null;
  const round = selected?.round ?? null;

  const [lots, counts, notices] = await Promise.all([
    round ? listAuctions(tenant.id, { roundId: round.id }) : Promise.resolve([]),
    recipientCounts(tenant.id),
    listNotices(tenant.id, 20),
  ]);
  const bySpecies = new Map<string, number>();
  for (const l of lots) bySpecies.set(l.speciesName ?? l.auction.speciesCode, (bySpecies.get(l.speciesName ?? l.auction.speciesCode) ?? 0) + 1);
  const speciesSummary = [...bySpecies.entries()].map(([n, c]) => `${n} ${c}`).join(", ") || "없음";
  const slot = round ? tenant.schedule.find((s) => s.seq === round.seq) : undefined;
  const lastAuto = notices.find((n) => n.notice.mode === "auto" && (!round || n.notice.roundId === round.id));
  const canSend = hasPermission(ctx, "notice.send") && !ctx.readOnly;

  return (
    <>
      <PageTitle title="경매 공지" uc="UC-02">
        <span className="muted small">발송 채널: {tenant.notificationConfig.channels.map((c) => CHANNEL_LABEL[c]).join(" + ")}</span>
        <RoundSelect options={rounds.map((r) => ({ id: r.round.id, label: r.round.label, hint: `${ROUND_STATUS[r.round.status].label} · ${r.lotCount}품목` }))} value={round?.id ?? null} />
      </PageTitle>

      {!round ? (
        <div className="panel"><div className="empty-state"><div className="emoji">📅</div>공지할 회차가 없습니다. 수협 관리에서 경매 일정을 확인하세요.</div></div>
      ) : (
        <NoticeForm
          code={code}
          canSend={canSend}
          fieldEnabled={tenant.fieldAuctionEnabled}
          bufferMin={tenant.digitalCloseBufferMin}
          round={{ id: round.id, label: round.label, status: round.status, statusLabel: ROUND_STATUS[round.status].label, bidStartAt: toLocalInput(round.bidStartAt), bidCloseAt: toLocalInput(round.bidCloseAt), fieldStartAt: toLocalInput(round.fieldStartAt), autoNoticedAt: round.autoNoticedAt ? fmtDateTime(round.autoNoticedAt) : null }}
          autoNoticeAt={slot?.autoNoticeAt ?? null}
          lastAuto={lastAuto ? { title: lastAuto.notice.title, sentAt: fmtDateTime(lastAuto.notice.sentAt), recipients: lastAuto.notice.recipientCount } : null}
          lotCount={lots.length}
          counts={counts}
          defaultTitle={`${round.label} 경매 공지`}
          defaultMessage={defaultMessage(tenant, round, lots.length, speciesSummary)}
          tenantName={tenant.name}
        />
      )}

      <div className="panel">
        <div className="panel-header"><h2>이번 회차 포함 품목 <span className="muted small">({lots.length}건)</span></h2></div>
        <div className="panel-body dense">
          {lots.length === 0 ? <div className="empty-state" style={{ padding: 30 }}><div className="emoji">🐟</div>이 회차에 확정된 품목이 없습니다</div> : (
            <table className="data-table">
              <thead><tr><th>경매번호</th><th>선박</th><th>어종</th><th className="num">중량(kg)</th><th className="num">수량</th><th>단위</th><th>등급</th><th>상태</th></tr></thead>
              <tbody>
                {lots.map(({ auction: a, speciesName, vesselName }) => (
                  <tr key={a.id}>
                    <td className="mono small">{a.auctionNo ?? "-"}</td><td>{vesselName}</td><td>{speciesName ?? a.speciesCode}</td>
                    <td className="num">{num(a.weightKg, 1)}</td><td className="num">{a.unit === "kg" ? "-" : `${num(a.quantity)}${unitLabel(a.unit)}`}</td>
                    <td>{unitLabel(a.unit)}</td><td>{a.grade}</td><td><StatusBadge map={AUCTION_STATUS} value={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>최근 공지 이력</h2></div>
        <div className="panel-body dense">
          {notices.length === 0 ? <div className="empty-state" style={{ padding: 30 }}><div className="emoji">📢</div>발송 이력이 없습니다</div> : (
            <table className="data-table">
              <thead><tr><th>발송시각</th><th>회차</th><th>유형</th><th>제목</th><th>대상</th><th>채널</th><th className="num">수신</th><th className="num">성공/실패</th></tr></thead>
              <tbody>
                {notices.map(({ notice: n, roundLabel }) => (
                  <tr key={n.id}>
                    <td className="mono">{fmtDateTime(n.sentAt)}</td>
                    <td>{roundLabel ?? "-"}</td>
                    <td>{n.mode === "auto" ? <Badge tone="muted">자동</Badge> : <Badge tone="info">수동</Badge>}</td>
                    <td>{n.title}</td>
                    <td className="small">{n.targets.map((t) => TARGET_LABEL[t]).join(", ")}</td>
                    <td className="small">{n.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}</td>
                    <td className="num">{num(n.recipientCount)}명</td>
                    <td className="num"><span className="text-success">{num(n.successCount)}</span> / <span className={n.failCount ? "text-danger" : "muted"}>{num(n.failCount)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="muted small">회차 시간표: 입찰 {round ? `${fmtTime(round.bidStartAt)}~${fmtTime(round.bidCloseAt)}` : "-"}{round?.fieldStartAt ? ` · 현장 ${fmtTime(round.fieldStartAt)}` : ""}</p>
    </>
  );
}
