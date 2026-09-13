import { Badge } from "./Badge";
import { fmtDateTime } from "@/lib/format";

export interface AuditLogRow {
  at: Date; action: string; targetType: string | null; targetId: string | null;
  before: unknown; after: unknown; reason: string | null; ip: string | null;
  actorName: string | null; actorRole: string | null; tenantName?: string | null;
}

type Tone = "success" | "danger" | "warning" | "info" | "muted";

/** action 접두어 → 배지 톤 */
function actionTone(action: string): Tone {
  if (/suspend|reject|revoke|fail|cancel|delete|withdraw/.test(action)) return "danger";
  if (/approve|activate|accept|award|confirm|create|register|invite$/.test(action)) return "success";
  if (/settings|update|correct|resend|license|fee/.test(action)) return "warning";
  if (/^auth\.|^platform\./.test(action)) return "muted";
  return "info";
}

const ACTION_LABEL: Record<string, string> = {
  "tenant.settings.general": "설정·일반", "tenant.settings.auction": "설정·경매", "tenant.settings.units": "설정·단위", "tenant.settings.fees": "설정·수수료",
  "tenant.settings.notification": "설정·알림", "tenant.settings.accounting": "설정·회계",
  "membership.invite": "멤버 초청", "membership.invite_resend": "초청 재발송", "membership.invite_cancel": "초청 취소", "membership.accept_invite": "초청 수락",
  "membership.suspend": "멤버 정지", "membership.activate": "멤버 활성", "membership.add_role": "역할 추가",
  "license.update": "면허 변경", "shipper.register": "선주 등록", "shipper.update": "선주 수정",
  "vessel.create": "선박 등록", "vessel.update": "선박 수정",
  "auth.login": "로그인", "auth.login_failed": "로그인 실패", "auth.select_tenant": "수협 전환", "platform.enter_tenant": "P.Admin 진입",
  "auction.open": "개찰", "auction.field_result": "현장 결과", "auction.reauction_request": "재개찰 신청", "dispute.approve": "분쟁 승인", "dispute.reject": "분쟁 거부", "dispute.objection": "이의 제기",
  "round.create": "회차 생성", "round.update": "회차 수정",
};
export const auditActionLabel = (a: string) => ACTION_LABEL[a] ?? a;

const TARGET_LABEL: Record<string, string> = { tenant: "수협", membership: "멤버", invitation: "초청", user: "사용자", vessel: "선박", auction: "경매", dispute: "분쟁", round: "회차", intake: "입고", settlement: "정산", notice: "공지", bid: "입찰" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const short = (v: unknown): string => {
  if (v == null) return "∅";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 38)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return fmtDateTime(v);
  const s = JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 38)}…` : s;
};

/** before/after 차이 요약 — 변경된 키만 "key: a → b" */
export function diffSummary(before: unknown, after: unknown): { key: string; from: string; to: string }[] {
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ key: k, from: short(before[k]), to: short(after[k]) })).slice(0, 8);
  }
  if (!before && isObj(after)) return Object.entries(after).filter(([, v]) => v != null).slice(0, 6).map(([k, v]) => ({ key: k, from: "", to: short(v) }));
  if (isObj(before) && !after) return Object.entries(before).filter(([, v]) => v != null).slice(0, 6).map(([k, v]) => ({ key: k, from: short(v), to: "" }));
  return [];
}

/**
 * 공통 감사 로그 테이블 (Tenant Admin / Platform Console 공용).
 * 컬럼: 시각 · 구분 · 내용(대상 + 변경 요약) · 처리자 · IP · (Tenant)
 */
export function AuditLogTable({ rows, showTenant }: { rows: AuditLogRow[]; showTenant?: boolean }) {
  if (rows.length === 0) return <div className="empty-state"><div className="emoji">🧾</div>조건에 맞는 감사 로그가 없습니다</div>;
  return (
    <div className="table-scroll">
      <table className="data-table audit-table">
        <thead>
          <tr>
            <th style={{ width: 140 }}>시각</th>
            <th style={{ width: 130 }}>구분</th>
            <th>내용</th>
            <th style={{ width: 130 }}>처리자</th>
            <th style={{ width: 110 }}>IP</th>
            {showTenant && <th style={{ width: 120 }}>Tenant</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const diff = diffSummary(r.before, r.after);
            return (
              <tr key={`${r.at.getTime()}-${i}`}>
                <td className="mono small">{fmtDateTime(r.at, { second: "2-digit" })}</td>
                <td><Badge tone={actionTone(r.action)}>{auditActionLabel(r.action)}</Badge><div className="muted small mono">{r.action}</div></td>
                <td>
                  {(r.targetType || r.targetId) && (
                    <div className="small">
                      <span className="muted">{r.targetType ? TARGET_LABEL[r.targetType] ?? r.targetType : "대상"}</span>{" "}
                      {r.targetId && <code className="audit-id" title={r.targetId}>{r.targetId.length > 12 ? `${r.targetId.slice(0, 8)}…` : r.targetId}</code>}
                    </div>
                  )}
                  {diff.length > 0 && (
                    <ul className="audit-diff">
                      {diff.map((d) => (
                        <li key={d.key}><span className="audit-key">{d.key}</span>{d.from && <span className="audit-from">{d.from}</span>}{d.from && d.to && <span className="muted"> → </span>}{d.to && <span className="audit-to">{d.to}</span>}</li>
                      ))}
                    </ul>
                  )}
                  {r.reason && <div className="small muted">사유: {r.reason}</div>}
                </td>
                <td>{r.actorName ?? <span className="muted">시스템</span>}{r.actorRole && <div className="muted small">{r.actorRole}</div>}</td>
                <td className="mono small muted">{r.ip ?? "-"}</td>
                {showTenant && <td className="small">{r.tenantName ?? <span className="muted">-</span>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
