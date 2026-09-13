"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ConfirmModal } from "@/components/Modal";
import { Badge, StatusBadge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import { MEMBERSHIP_STATUS, LICENSE_STATUS } from "@/domain/status";
import { ROLE_LABEL, ROLE_PRIORITY, FORBIDDEN_ROLE_PAIRS } from "@/lib/authz/matrix";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Role, MembershipStatus, LicenseStatus } from "@/db/schema";
import { inviteMemberAction, resendInvitationAction, cancelInvitationAction, setMembershipStatusAction, addRoleAction } from "./actions";

export interface MemberItem {
  userId: string; name: string; email: string | null; phone: string | null; lastLoginAt: string | null; identityVerified: boolean;
  memberships: { id: string; role: Role; status: MembershipStatus; licenseNo: string | null; licenseStatus: LicenseStatus | null; licenseExpiresAt: string | null; title: string | null; joinedAt: string | null; createdAt: string }[];
}
export interface InvitationItem { id: string; name: string; email: string; phone: string | null; role: Role; licenseNo: string | null; title: string | null; inviterName: string | null; expiresAt: string; createdAt: string; expired: boolean }

const ROLE_TONE: Record<Role, "success" | "danger" | "warning" | "info" | "muted"> = { admin: "danger", operator: "info", receiver: "info", broker: "warning", shipper: "success", union: "muted" };
const fmtPhone = (p: string | null) => (p && /^\d{10,11}$/.test(p) ? p.replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : p ?? "-");

export function MembersClient({ code, members, invitations, canWrite, currentUserId, openInvite }:
  { code: string; members: MemberItem[]; invitations: InvitationItem[]; canWrite: boolean; currentUserId: string; openInvite?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [invite, setInvite] = useState(!!openInvite && canWrite);
  const [statusTarget, setStatusTarget] = useState<{ m: MemberItem["memberships"][number]; user: MemberItem; next: "active" | "suspended" } | null>(null);
  const [roleTarget, setRoleTarget] = useState<MemberItem | null>(null);
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const [reason, setReason] = useState("");

  const doStatus = () => {
    if (!statusTarget) return;
    start(async () => {
      const r = await setMembershipStatusAction(code, statusTarget.m.id, statusTarget.next, reason);
      toast(r.ok ? r.message ?? "처리했습니다" : r.error);
      if (r.ok) { setStatusTarget(null); setReason(""); router.refresh(); }
    });
  };
  const resend = (id: string) => start(async () => {
    const r = await resendInvitationAction(code, id);
    toast(r.ok ? r.message ?? "재발송" : r.error);
    if (r.ok && r.data) { setLink({ title: "초청 링크 (재발송)", url: r.data.inviteLink }); router.refresh(); }
  });
  const cancel = (id: string) => {
    if (!confirm("이 초청을 취소할까요? 링크가 즉시 무효화됩니다.")) return;
    start(async () => { const r = await cancelInvitationAction(code, id); toast(r.ok ? r.message ?? "취소" : r.error); if (r.ok) router.refresh(); });
  };

  return (
    <>
      <div className="panel-header" style={{ borderTop: "1px solid var(--color-border)" }}>
        <h2>멤버 <span className="muted small">{members.length}명</span></h2>
        {canWrite && <button className="btn-primary" onClick={() => setInvite(true)}>+ 멤버 초청</button>}
      </div>
      <div className="panel-body dense">
        {members.length === 0 ? <div className="empty-state"><div className="emoji">👥</div>조건에 맞는 멤버가 없습니다</div> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>이름</th><th>이메일</th><th>전화</th><th>역할</th><th>면허</th><th>상태</th><th>가입일</th><th>마지막 로그인</th>{canWrite && <th>액션</th>}</tr></thead>
              <tbody>
                {members.map((u) => {
                  const broker = u.memberships.find((m) => m.role === "broker");
                  const joined = u.memberships.map((m) => m.joinedAt).filter((x): x is string => !!x).sort()[0] ?? null;
                  const statuses = [...new Set(u.memberships.map((m) => m.status))];
                  return (
                    <tr key={u.userId}>
                      <td><b>{u.name}</b>{u.userId === currentUserId && <span className="muted small"> (나)</span>}{u.memberships.some((m) => m.title) && <div className="muted small">{u.memberships.map((m) => m.title).filter(Boolean).join("·")}</div>}</td>
                      <td className="small">{u.email ?? "-"}</td>
                      <td className="small mono">{fmtPhone(u.phone)}</td>
                      <td><div className="role-badges">{u.memberships.map((m) => <Badge key={m.id} tone={m.status === "active" ? ROLE_TONE[m.role] : "muted"}>{ROLE_LABEL[m.role]}{m.status !== "active" && ` · ${MEMBERSHIP_STATUS[m.status].label}`}</Badge>)}</div></td>
                      <td className="small">{broker ? <>{broker.licenseNo ?? "-"} {broker.licenseStatus && <StatusBadge map={LICENSE_STATUS} value={broker.licenseStatus} />}</> : <span className="muted">-</span>}</td>
                      <td>{statuses.length === 1 ? <StatusBadge map={MEMBERSHIP_STATUS} value={statuses[0]} /> : <span className="small muted">역할별 상이</span>}</td>
                      <td className="small">{fmtDate(joined)}</td>
                      <td className="small muted">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "-"}</td>
                      {canWrite && (
                        <td>
                          <div className="row-actions">
                            {u.memberships.map((m) => m.status === "active"
                              ? (u.userId !== currentUserId && <button key={m.id} className="btn-secondary" disabled={pending} onClick={() => { setReason(""); setStatusTarget({ m, user: u, next: "suspended" }); }}>{ROLE_LABEL[m.role]} 정지</button>)
                              : <button key={m.id} className="btn-secondary" disabled={pending} onClick={() => { setReason(""); setStatusTarget({ m, user: u, next: "active" }); }}>{ROLE_LABEL[m.role]} 활성</button>)}
                            <button className="btn-ghost" disabled={pending} onClick={() => setRoleTarget(u)}>역할 추가</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel-header" style={{ borderTop: "1px solid var(--color-border)" }}>
        <h2>대기중 초청 <span className="muted small">{invitations.length}건</span></h2>
      </div>
      <div className="panel-body dense">
        {invitations.length === 0 ? <div className="empty-state" style={{ padding: 28 }}>대기중인 초청이 없습니다</div> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>면허번호</th><th>초청자</th><th>만료</th>{canWrite && <th>액션</th>}</tr></thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td><b>{i.name}</b>{i.title && <span className="muted small"> · {i.title}</span>}</td>
                    <td className="small">{i.email}{i.phone && <div className="muted mono">{fmtPhone(i.phone)}</div>}</td>
                    <td><Badge tone={ROLE_TONE[i.role]}>{ROLE_LABEL[i.role]}</Badge></td>
                    <td className="small mono">{i.licenseNo ?? "-"}</td>
                    <td className="small">{i.inviterName ?? "-"}</td>
                    <td className="small">{i.expired ? <Badge tone="danger">만료됨</Badge> : <>{fmtDateTime(i.expiresAt)}</>}</td>
                    {canWrite && <td><div className="row-actions"><button className="btn-secondary" disabled={pending} onClick={() => resend(i.id)}>재발송</button><button className="btn-ghost" disabled={pending} onClick={() => cancel(i.id)}>취소</button></div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {invite && <InviteModal code={code} onClose={() => setInvite(false)} onDone={(url) => { setInvite(false); setLink({ title: "초청 링크", url }); router.refresh(); }} />}
      {roleTarget && <AddRoleModal code={code} user={roleTarget} onClose={() => setRoleTarget(null)} onDone={() => { setRoleTarget(null); router.refresh(); }} />}
      {statusTarget && (
        <ConfirmModal title={`${statusTarget.user.name} · ${ROLE_LABEL[statusTarget.m.role]} ${statusTarget.next === "suspended" ? "정지" : "활성화"}`} danger={statusTarget.next === "suspended"}
          confirmLabel={statusTarget.next === "suspended" ? "정지" : "활성화"} onConfirm={doStatus} onClose={() => setStatusTarget(null)} busy={pending}
          message={statusTarget.next === "suspended" ? (statusTarget.m.role === "broker" ? "정지하면 로그인 후 이 역할로 진입할 수 없고 면허도 정지 상태가 됩니다." : "정지하면 이 역할로 진입할 수 없습니다.") : "다시 활성화하면 즉시 이 역할로 이용할 수 있습니다."}>
          <div className="field"><label>{statusTarget.next === "suspended" ? "정지 사유 *" : "메모 (선택)"}</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={statusTarget.next === "suspended" ? "예: 면허 갱신 미이행" : ""} autoFocus /></div>
        </ConfirmModal>
      )}
      {link && (
        <Modal title={link.title} onClose={() => setLink(null)} footer={<button className="btn-primary" onClick={() => setLink(null)}>닫기</button>}>
          <p style={{ marginTop: 0 }}>초청 메일(Mock)이 발송되었습니다. 개발 환경에서는 아래 링크로 바로 수락 화면을 열 수 있습니다.</p>
          <div className="invite-link"><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></div>
        </Modal>
      )}
    </>
  );
}

function InviteModal({ code, onClose, onDone }: { code: string; onClose: () => void; onDone: (link: string) => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", email: "", phone: "", role: "operator" as Role, licenseNo: "", title: "", licenseExpiresAt: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => start(async () => {
    const r = await inviteMemberAction(code, f);
    if (r.ok && r.data) { toast(r.message ?? "초청했습니다"); onDone(r.data.inviteLink); }
    else if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error); }
  });
  const err = (k: string) => (errors[k] ? <div className="field-error">{errors[k]}</div> : null);
  return (
    <Modal title="멤버 초청" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className="btn-primary" onClick={submit} disabled={pending}>{pending ? <span className="spinner" /> : "초청 메일 발송"}</button></>}>
      <div className="form-grid">
        <div className="field"><label>이름 *</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="김운영" minLength={2} maxLength={20} autoFocus />{err("name")}</div>
        <div className="field"><label>역할 *</label>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLE_PRIORITY.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label>이메일 *</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="kim@example.com" />{err("email")}</div>
        <div className="field"><label>전화</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="010-0000-0000" />{err("phone")}</div>
        <div className="field"><label>직책</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="위판과장" />{err("title")}</div>
        {f.role === "broker" && (
          <>
            <div className="field"><label>면허번호 *</label><input value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} placeholder="M-201" />{err("licenseNo")}</div>
            <div className="field"><label>면허 만료일</label><input type="date" value={f.licenseExpiresAt} onChange={(e) => setF({ ...f, licenseExpiresAt: e.target.value })} />{err("licenseExpiresAt")}</div>
          </>
        )}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>초청 링크는 7일간 유효합니다. {f.role === "broker" && "중매인은 운영자/관리자와 겸임할 수 없습니다."}</p>
    </Modal>
  );
}

function AddRoleModal({ code, user, onClose, onDone }: { code: string; user: MemberItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const have = user.memberships.map((m) => m.role);
  const forbidden = (r: Role) => FORBIDDEN_ROLE_PAIRS.some(([a, b]) => (r === a && have.includes(b)) || (r === b && have.includes(a)));
  const options = ROLE_PRIORITY.filter((r) => !have.includes(r));
  const [role, setRole] = useState<Role | "">(options.find((r) => !forbidden(r)) ?? "");
  const [licenseNo, setLicenseNo] = useState("");
  const submit = () => {
    if (!role) return;
    start(async () => { const r = await addRoleAction(code, user.userId, role, licenseNo); toast(r.ok ? r.message ?? "추가했습니다" : r.error); if (r.ok) onDone(); });
  };
  return (
    <Modal title={`${user.name} · 역할 추가`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className="btn-primary" onClick={submit} disabled={pending || !role}>{pending ? <span className="spinner" /> : "추가"}</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>현재 역할: {have.map((r) => ROLE_LABEL[r]).join(", ")}</p>
      <div className="field"><label>추가할 역할</label>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {options.length === 0 && <option value="">추가할 수 있는 역할이 없습니다</option>}
          {options.map((r) => <option key={r} value={r} disabled={forbidden(r)}>{ROLE_LABEL[r]}{forbidden(r) ? " (겸임 불가)" : ""}</option>)}
        </select></div>
      {role === "broker" && <div className="field"><label>면허번호 *</label><input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} placeholder="M-000" /></div>}
    </Modal>
  );
}
