import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { getTenantDetail } from "@/services/platform";
import { Badge, StatusBadge } from "@/components/Badge";
import { AuditLogTable } from "@/components/AuditLogTable";
import { TENANT_STATUS, MEMBERSHIP_STATUS, TIE_BREAK_LABEL, VISIBILITY_LABEL } from "@/domain/status";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { fmtDate, fmtDateTime, num, won } from "@/lib/format";
import type { Role } from "@/db/schema";
import { TenantActions } from "./TenantActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `수협 상세 · ${code}` };
}

const ROLES: Role[] = ["admin", "operator", "receiver", "broker", "shipper", "union"];
const WINNER_LABEL = { license_no: "면허번호 공개", anonymous: "비공개(익명)" } as const;

export default async function TenantDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ readmode?: string; next?: string }> }) {
  await requirePlatformAdmin();
  const { code } = await params;
  const sp = await searchParams;
  const d = await getTenantDetail(code);
  if (!d) notFound();
  const { tenant: t, memberCounts, admins, pendingInvites, activity, recentAudit } = d;
  const adminActive = memberCounts.admin.active;
  const maxDaily = Math.max(1, ...activity.daily.map((x) => x.amount));
  const fee = t.feePolicy;
  const lastInvite = pendingInvites[0] ?? null;
  const defaultAdmin = admins[0] ? { name: admins[0].name, email: admins[0].email ?? "", phone: admins[0].phone, title: admins[0].title }
    : lastInvite ? { name: lastInvite.name, email: lastInvite.email, phone: lastInvite.phone, title: lastInvite.title } : null;

  return (
    <>
      {sp.readmode === "required" && <div className="status-banner info mb-16" style={{ borderRadius: 10 }}>🔍 Platform Admin 은 수협 운영 데이터를 <b>분쟁 조회 모드</b>(사유 기록, 4시간 유효)로만 볼 수 있습니다. 아래에서 사유를 입력해 진입하세요.</div>}
      <div className="pf-head">
        <div>
          <h2>{t.name} <code style={{ fontSize: 13, fontWeight: 400 }}>{t.code}</code> <StatusBadge map={TENANT_STATUS} value={t.status} /></h2>
          <div className="sub"><Link href="/platform/tenants">← 수협 목록</Link> · {t.region ?? "-"} · 생성 {fmtDate(t.createdAt)}{t.activatedAt && <> · 활성화 {fmtDate(t.activatedAt)}</>}</div>
        </div>
        <TenantActions code={t.code} name={t.name} status={t.status} adminActiveCount={adminActive} defaultAdmin={defaultAdmin} readNext={sp.next} autoOpenRead={sp.readmode === "required"} />
      </div>

      {t.status === "suspended" && <div className="alert-card"><div><div className="title">⚠ 정지 상태</div><div className="reason">{t.suspendReason ?? "사유 미기재"}{t.suspendedAt && ` · 정지일 ${fmtDateTime(t.suspendedAt)}`}</div></div></div>}
      {t.status === "archived" && <div className="alert-card" style={{ borderColor: "#e5e7eb", background: "#f9fafb" }}><div><div className="title">아카이브됨 · {fmtDateTime(t.archivedAt)}</div><div className="reason" style={{ color: "#374151" }}>{t.suspendReason ?? ""} — 데이터는 법적 보존 기간 동안 읽기 전용으로 유지됩니다.</div></div></div>}
      {t.status === "pending" && adminActive < 1 && <div className="alert-card pending"><div><div className="title">⏳ 활성화 대기 — 초기 Admin 미가입</div><div className="reason">{lastInvite ? `초청 발송 ${fmtDateTime(lastInvite.createdAt)} · ${lastInvite.email} · 만료 ${fmtDateTime(lastInvite.expiresAt)}` : "유효한 초청이 없습니다. 초기 Admin 을 재초청하세요."}</div></div></div>}
      {t.status === "pending" && adminActive >= 1 && <div className="alert-card pending" style={{ borderColor: "#a7f3d0", background: "#ecfdf5" }}><div><div className="title">✅ 초기 Admin 가입 완료 — 활성화할 수 있습니다</div></div></div>}

      <div className="pf-grid">
        <div className="panel">
          <div className="panel-header"><h2>기본 정보</h2></div>
          <div className="panel-body">
            <dl className="kv wide">
              <dt>code</dt><dd><code>{t.code}</code></dd>
              <dt>이름</dt><dd>{t.name}</dd>
              <dt>지역</dt><dd>{t.region ?? "-"}</dd>
              <dt>위판장 주소</dt><dd>{t.address ?? "-"}</dd>
              <dt>사업자등록번호</dt><dd>{t.businessNo ?? "-"}</dd>
              <dt>연락 이메일</dt><dd>{t.contactEmail ?? "-"}</dd>
              <dt>연락 전화</dt><dd>{t.contactPhone ?? "-"}</dd>
              <dt>상태</dt><dd><StatusBadge map={TENANT_STATUS} value={t.status} /></dd>
              <dt>생성일</dt><dd>{fmtDateTime(t.createdAt)}</dd>
              <dt>활성화일</dt><dd>{fmtDateTime(t.activatedAt)}</dd>
              {t.suspendedAt && <><dt>정지일</dt><dd>{fmtDateTime(t.suspendedAt)}</dd></>}
              {t.archivedAt && <><dt>아카이브일</dt><dd>{fmtDateTime(t.archivedAt)}</dd></>}
            </dl>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h2>현재 설정 <span className="muted small">(읽기 전용 — 변경은 수협 Admin)</span></h2></div>
          <div className="panel-body">
            <dl className="kv wide">
              <dt>위판수수료</dt><dd>{num(fee.marketFeeRate * 100, 2)}%</dd>
              <dt>중매인수수료</dt><dd>{num(fee.brokerFeeRate * 100, 2)}%</dd>
              <dt>VAT</dt><dd>{fee.vatIncluded ? "수수료에 포함" : `별도 가산 ${num(fee.vatRate * 100)}%`}</dd>
              <dt>회차 시간표</dt><dd>{t.schedule.length === 0 ? <span className="muted">미설정</span> : t.schedule.map((s) => <div key={s.seq}>{s.seq}. {s.label} {s.bidStart}~{s.bidClose}{s.autoNoticeAt && <span className="muted"> · 자동공지 {s.autoNoticeAt}</span>}</div>)}</dd>
              <dt>디지털 마감 버퍼</dt><dd>{t.digitalCloseBufferMin}분</dd>
              <dt>동일가 처리</dt><dd title={TIE_BREAK_LABEL[t.tieBreakPolicy]}>{t.tieBreakPolicy}</dd>
              <dt>디지털가 공개</dt><dd title={VISIBILITY_LABEL[t.digitalPriceVisibility]}>{t.digitalPriceVisibility}</dd>
              <dt>입찰 수정 허용</dt><dd>{t.bidModificationAllowed ? "허용" : "불허"}</dd>
              <dt>현장 경매</dt><dd>{t.fieldAuctionEnabled ? "사용" : "미사용"}</dd>
              <dt>입찰 MFA</dt><dd>{t.bidMfaRequired ? "필수" : "미사용"}</dd>
              <dt>낙찰자 공개</dt><dd>{WINNER_LABEL[t.winnerDisclosure]}</dd>
              <dt>단위 환산표</dt><dd>{Object.keys(t.boxWeightTable).length}종 등록</dd>
              <dt>최저가(예가)</dt><dd>{Object.keys(t.reservePrices).length}종 등록</dd>
              <dt>알림 채널</dt><dd>{t.notificationConfig.channels.join(", ")}</dd>
              <dt>회계 연동</dt><dd>{t.accountingAdapter}</dd>
            </dl>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h2>수협 Admin</h2><span className="muted small">활성 {adminActive}명</span></div>
          <div className="panel-body dense">
            <table className="data-table">
              <thead><tr><th>이름</th><th>이메일 / 전화</th><th>직책</th><th>상태</th><th>가입일</th><th>최근 로그인</th></tr></thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.membershipId}>
                    <td><Link href={`/platform/users/${a.userId}`}>{a.name}</Link></td>
                    <td className="small">{a.email ?? "-"}<div className="muted">{a.phone ?? ""}</div></td>
                    <td>{a.title ?? "-"}</td>
                    <td><StatusBadge map={MEMBERSHIP_STATUS} value={a.status} /></td>
                    <td>{fmtDate(a.joinedAt)}</td>
                    <td>{fmtDateTime(a.lastLoginAt)}</td>
                  </tr>
                ))}
                {admins.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>가입한 Admin 이 없습니다</td></tr>}
              </tbody>
            </table>
            {pendingInvites.length > 0 && (
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)" }}>
                <div className="small muted mb-8">미수락 초청</div>
                {pendingInvites.map((i) => {
                  const expired = i.expiresAt.getTime() < Date.now();
                  return <div key={i.id} className="small flex flex-wrap" style={{ padding: "3px 0" }}>{i.name} · {i.email} <Badge tone={expired ? "muted" : "warning"}>{expired ? "만료" : "대기"}</Badge> <span className="muted">발송 {fmtDateTime(i.createdAt)} · 만료 {fmtDateTime(i.expiresAt)}</span></div>;
                })}
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h2>Membership (역할별)</h2></div>
          <div className="panel-body">
            <div className="member-counts">
              {ROLES.map((r) => (
                <div key={r} className="cell">
                  <div className="k">{ROLE_LABEL[r]}</div>
                  <div className="v">{memberCounts[r].active}</div>
                  <div className="s">{memberCounts[r].invited ? `초청중 ${memberCounts[r].invited}` : ""}{memberCounts[r].invited && memberCounts[r].suspended ? " · " : ""}{memberCounts[r].suspended ? `정지 ${memberCounts[r].suspended}` : ""}{!memberCounts[r].invited && !memberCounts[r].suspended ? "활성" : ""}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel span-2">
          <div className="panel-header"><h2>최근 30일 거래</h2><Link href={`/platform/stats`} className="small">플랫폼 통계 →</Link></div>
          <div className="panel-body">
            <div className="kpi-grid" style={{ marginBottom: 12 }}>
              <div className="kpi-card"><div className="kpi-label">회차</div><div className="kpi-value">{num(activity.rounds)}</div></div>
              <div className="kpi-card"><div className="kpi-label">거래(로트)</div><div className="kpi-value">{num(activity.lots)}</div><div className="kpi-sub">낙찰 {num(activity.awardedLots)}</div></div>
              <div className="kpi-card"><div className="kpi-label">낙찰 금액</div><div className="kpi-value">{won(activity.awardedAmount)}</div></div>
              <div className="kpi-card"><div className="kpi-label">회차당 평균 로트</div><div className="kpi-value">{activity.rounds ? num(activity.lots / activity.rounds, 1) : "-"}</div></div>
            </div>
            {activity.daily.length === 0 ? <div className="muted small">최근 30일 거래 데이터가 없습니다</div> : (
              <>
                <div className="spark" title="일자별 낙찰 금액">
                  {activity.daily.map((x) => <span key={x.date} className={x.amount === 0 ? "zero" : undefined} style={{ height: `${Math.max(4, Math.round((x.amount / maxDaily) * 100))}%` }} title={`${x.date} · ${x.lots}로트 · ${won(x.amount)}`} />)}
                </div>
                <div className="spark-meta"><span>{activity.daily[0].date}</span><span>{activity.daily[activity.daily.length - 1].date}</span></div>
              </>
            )}
          </div>
        </div>

        <div className="panel span-2">
          <div className="panel-header"><h2>최근 감사 로그 (10건)</h2><Link href={`/platform/audit-logs?tenantId=${t.id}`} className="small">감사 로그 전체 보기 →</Link></div>
          <div className="panel-body dense"><AuditLogTable rows={recentAudit} /></div>
        </div>
      </div>
    </>
  );
}
