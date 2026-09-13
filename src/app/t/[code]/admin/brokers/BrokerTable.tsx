"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { StatusBadge, Badge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import { LICENSE_STATUS, MEMBERSHIP_STATUS } from "@/domain/status";
import { fmtDate, fmtDateTime, num, won } from "@/lib/format";
import type { LicenseStatus, MembershipStatus } from "@/db/schema";
import { updateLicenseAction } from "./actions";

export interface BrokerItem {
  membershipId: string; userId: string; name: string; phone: string | null; email: string | null;
  licenseNo: string | null; licenseStatus: LicenseStatus | null; licenseExpiresAt: string | null; membershipStatus: MembershipStatus; joinedAt: string | null;
  daysLeft: number | null; awardedLots30d: number; awardedAmount30d: number; lastAwardedAt: string | null;
}

const fmtPhone = (p: string | null) => (p && /^\d{10,11}$/.test(p) ? p.replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : p ?? "-");
const addYears = (d: string | null, n: number) => { const base = d && d >= new Date().toISOString().slice(0, 10) ? new Date(`${d}T00:00:00+09:00`) : new Date(); base.setFullYear(base.getFullYear() + n); return base.toISOString().slice(0, 10); };

export function BrokerTable({ code, rows, canWrite }: { code: string; rows: BrokerItem[]; canWrite: boolean }) {
  const [edit, setEdit] = useState<{ row: BrokerItem; mode: "renew" | "suspend" | "revoke" | "edit" } | null>(null);
  if (rows.length === 0) return <div className="empty-state"><div className="emoji">🪪</div>등록된 중매인이 없습니다</div>;
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>이름</th><th>연락처</th><th>면허번호</th><th>면허 상태</th><th>만료일</th><th>멤버 상태</th><th className="num">30일 낙찰 건수</th><th className="num">30일 낙찰 금액</th><th>최근 낙찰</th>{canWrite && <th>액션</th>}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const urgent = r.licenseStatus === "active" && r.daysLeft != null && r.daysLeft <= 30;
              const terminal = r.licenseStatus === "revoked";
              return (
                <tr key={r.membershipId}>
                  <td><b>{r.name}</b></td>
                  <td className="small">{fmtPhone(r.phone)}{r.email && <div className="muted">{r.email}</div>}</td>
                  <td className="mono">{r.licenseNo ?? "-"}</td>
                  <td>{r.licenseStatus ? <StatusBadge map={LICENSE_STATUS} value={r.licenseStatus} /> : <Badge tone="muted">미등록</Badge>}</td>
                  <td className="small">
                    {fmtDate(r.licenseExpiresAt)}
                    {r.daysLeft != null && r.licenseStatus !== "revoked" && (
                      <span className={`days-left ${r.daysLeft < 0 ? "danger" : r.daysLeft <= 7 ? "danger" : urgent ? "warn" : ""}`}>{r.daysLeft < 0 ? `${-r.daysLeft}일 경과` : r.daysLeft <= 30 ? `D-${r.daysLeft}` : ""}</span>
                    )}
                  </td>
                  <td><StatusBadge map={MEMBERSHIP_STATUS} value={r.membershipStatus} /></td>
                  <td className="num">{num(r.awardedLots30d)}건</td>
                  <td className="num">{won(r.awardedAmount30d)}</td>
                  <td className="small muted">{r.lastAwardedAt ? fmtDateTime(r.lastAwardedAt) : "-"}</td>
                  {canWrite && (
                    <td>
                      <div className="row-actions">
                        {!terminal && <button className="btn-primary" onClick={() => setEdit({ row: r, mode: "renew" })}>갱신</button>}
                        {!terminal && r.licenseStatus !== "suspended" && <button className="btn-secondary" onClick={() => setEdit({ row: r, mode: "suspend" })}>정지</button>}
                        {!terminal && <button className="btn-secondary" onClick={() => setEdit({ row: r, mode: "edit" })}>수정</button>}
                        {!terminal && <button className="btn-danger" onClick={() => setEdit({ row: r, mode: "revoke" })}>취소</button>}
                        {terminal && <span className="muted small">종결</span>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && <LicenseModal code={code} row={edit.row} mode={edit.mode} onClose={() => setEdit(null)} />}
    </>
  );
}

const TITLE = { renew: "면허 갱신", suspend: "면허 정지", revoke: "면허 취소 (회복 불가)", edit: "면허 정보 수정" } as const;

function LicenseModal({ code, row, mode, onClose }: { code: string; row: BrokerItem; mode: "renew" | "suspend" | "revoke" | "edit"; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    licenseNo: row.licenseNo ?? "",
    licenseStatus: (mode === "renew" ? "active" : mode === "suspend" ? "suspended" : mode === "revoke" ? "revoked" : row.licenseStatus ?? "active") as LicenseStatus,
    licenseExpiresAt: mode === "renew" ? addYears(row.licenseExpiresAt, 1) : row.licenseExpiresAt ?? "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const needsReason = f.licenseStatus === "suspended" || f.licenseStatus === "revoked";
  const submit = () => {
    if (mode === "revoke" && !confirm("면허를 취소하면 다시 유효 상태로 되돌릴 수 없습니다. 계속할까요?")) return;
    start(async () => {
      const r = await updateLicenseAction(code, row.membershipId, { licenseNo: f.licenseNo, licenseStatus: f.licenseStatus, licenseExpiresAt: f.licenseExpiresAt }, f.reason);
      if (r.ok) { toast(r.message ?? "변경했습니다"); onClose(); router.refresh(); }
      else { setErrors(r.fieldErrors ?? {}); toast(r.error); }
    });
  };
  return (
    <Modal title={`${row.name} · ${TITLE[mode]}`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className={mode === "revoke" ? "btn-danger" : "btn-primary"} onClick={submit} disabled={pending || (needsReason && !f.reason.trim())}>{pending ? <span className="spinner" /> : mode === "revoke" ? "면허 취소" : "저장"}</button></>}>
      <div className="form-grid">
        <div className="field"><label>면허번호</label><input value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} disabled={mode === "revoke" || mode === "suspend"} />{errors.licenseNo && <div className="field-error">{errors.licenseNo}</div>}</div>
        <div className="field"><label>상태</label>
          <select value={f.licenseStatus} onChange={(e) => setF({ ...f, licenseStatus: e.target.value as LicenseStatus })} disabled={mode !== "edit"}>
            {(["active", "expired", "suspended", "revoked"] as const).map((s) => <option key={s} value={s}>{LICENSE_STATUS[s].label}</option>)}
          </select></div>
        <div className="field"><label>만료일</label><input type="date" value={f.licenseExpiresAt} onChange={(e) => setF({ ...f, licenseExpiresAt: e.target.value })} disabled={mode === "revoke" || mode === "suspend"} />{errors.licenseExpiresAt && <div className="field-error">{errors.licenseExpiresAt}</div>}</div>
        {mode === "renew" && <div className="field"><label>빠른 선택</label><div className="row-actions">{[1, 2, 3].map((n) => <button key={n} type="button" className="btn-secondary" onClick={() => setF({ ...f, licenseExpiresAt: addYears(row.licenseExpiresAt, n) })}>+{n}년</button>)}</div></div>}
      </div>
      <div className="field" style={{ marginTop: 14 }}><label>{needsReason ? "사유 *" : "사유 (선택)"}</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={mode === "suspend" ? "예: 정산 미납" : mode === "revoke" ? "예: 면허 반납" : ""} /></div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        {mode === "renew" && "만료일을 연장하면 만료 상태의 면허는 자동으로 유효 상태가 됩니다."}
        {mode === "suspend" && "정지된 중매인은 입찰할 수 없습니다. 멤버 관리에서 활성화하거나 여기서 상태를 유효로 변경해 해제합니다."}
        {mode === "revoke" && "취소는 종결 상태입니다. 재등록은 새 초청으로 진행하세요."}
        {mode === "edit" && "취소(revoked) 상태는 되돌릴 수 없으며, 만료된 면허를 유효로 바꾸려면 만료일이 오늘 이후여야 합니다."}
      </p>
    </Modal>
  );
}
