"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { Badge, StatusBadge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import { MEMBERSHIP_STATUS } from "@/domain/status";
import { fmtDate } from "@/lib/format";
import type { MembershipStatus } from "@/db/schema";
import { registerShipperAction, updateShipperAction, createVesselAction, setVesselActiveAction } from "./actions";

export interface ShipperItem { userId: string; name: string; phone: string | null; email: string | null; membershipId: string; status: MembershipStatus; bankAccount: string | null; joinedAt: string | null }
export interface VesselItem { id: string; name: string; registrationNo: string | null; shipperUserId: string | null; active: boolean }

const fmtPhone = (p: string | null) => (p && /^\d{10,11}$/.test(p) ? p.replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : p ?? "-");

export function ShippersClient({ code, shippers, vessels, canWrite }: { code: string; shippers: ShipperItem[]; vessels: VesselItem[]; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [register, setRegister] = useState(false);
  const [vesselFor, setVesselFor] = useState<ShipperItem | null>(null);
  const [editFor, setEditFor] = useState<ShipperItem | null>(null);
  const [temp, setTemp] = useState<{ name: string; pw: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const toggleVessel = (v: VesselItem) => {
    if (v.active && !confirm(`선박 "${v.name}"을(를) 비활성화할까요? 신규 입고에 선택할 수 없게 됩니다.`)) return;
    start(async () => { const r = await setVesselActiveAction(code, v.id, !v.active); toast(r.ok ? r.message ?? "처리" : r.error); if (r.ok) router.refresh(); });
  };
  const unassigned = vessels.filter((v) => !v.shipperUserId || !shippers.some((s) => s.userId === v.shipperUserId));

  return (
    <>
      <div className="panel">
        <div className="panel-header">
          <h2>선주 <span className="muted small">{shippers.length}명 · 선박 {vessels.filter((v) => v.active).length}척</span></h2>
          <div className="flex">
            <label className="small flex" style={{ margin: 0 }}><input type="checkbox" style={{ width: "auto" }} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 비활성 선박 표시</label>
            {canWrite && <button className="btn-primary" onClick={() => setRegister(true)}>+ 선주 등록</button>}
          </div>
        </div>
        <div className="panel-body dense">
          {shippers.length === 0 ? <div className="empty-state"><div className="emoji">🚢</div>등록된 선주가 없습니다</div> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>선주</th><th>연락처</th><th>계좌</th><th>상태</th><th>소유 선박</th><th>등록일</th>{canWrite && <th>액션</th>}</tr></thead>
                <tbody>
                  {shippers.map((s) => {
                    const mine = vessels.filter((v) => v.shipperUserId === s.userId && (showInactive || v.active));
                    return (
                      <tr key={s.membershipId}>
                        <td><b>{s.name}</b></td>
                        <td className="small mono">{fmtPhone(s.phone)}{s.email && <div className="muted" style={{ fontFamily: "inherit" }}>{s.email}</div>}</td>
                        <td className="small">{s.bankAccount ?? <span className="muted">-</span>}</td>
                        <td><StatusBadge map={MEMBERSHIP_STATUS} value={s.status} /></td>
                        <td>
                          {mine.length === 0 ? <span className="muted small">선박 없음</span> : (
                            <div className="role-badges">
                              {mine.map((v) => (
                                <span key={v.id} className={`badge ${v.active ? "badge-info" : "badge-muted"}`} title={v.registrationNo ?? ""}>
                                  {v.name}{v.registrationNo && <span className="muted"> · {v.registrationNo}</span>}
                                  {canWrite && <button type="button" className="btn-ghost" style={{ padding: "0 0 0 6px", fontSize: 11 }} disabled={pending} onClick={() => toggleVessel(v)}>{v.active ? "비활성" : "복구"}</button>}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="small">{fmtDate(s.joinedAt)}</td>
                        {canWrite && <td><div className="row-actions"><button className="btn-secondary" disabled={pending || s.status !== "active"} onClick={() => setVesselFor(s)}>+ 선박</button><button className="btn-ghost" disabled={pending} onClick={() => setEditFor(s)}>수정</button></div></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {unassigned.length > 0 && (
        <div className="panel">
          <div className="panel-header"><h2>선주 미지정 선박 <span className="muted small">{unassigned.length}척</span></h2></div>
          <div className="panel-body"><div className="role-badges">{unassigned.map((v) => <Badge key={v.id} tone={v.active ? "warning" : "muted"}>{v.name}</Badge>)}</div></div>
        </div>
      )}

      {register && <RegisterModal code={code} onClose={() => setRegister(false)} onDone={(t) => { setRegister(false); if (t) setTemp(t); router.refresh(); }} />}
      {vesselFor && <VesselModal code={code} shipper={vesselFor} onClose={() => setVesselFor(null)} onDone={() => { setVesselFor(null); router.refresh(); }} />}
      {editFor && <EditShipperModal code={code} shipper={editFor} onClose={() => setEditFor(null)} onDone={() => { setEditFor(null); router.refresh(); }} />}
      {temp && (
        <Modal title="선주 등록 완료" onClose={() => setTemp(null)} footer={<button className="btn-primary" onClick={() => setTemp(null)}>닫기</button>}>
          <p style={{ marginTop: 0 }}><b>{temp.name}</b> 님의 계정이 생성되었습니다. 아래 임시 비밀번호를 전달하세요 (개발 환경에서만 표시).</p>
          <div className="invite-link">{temp.pw}</div>
        </Modal>
      )}
    </>
  );
}

function RegisterModal({ code, onClose, onDone }: { code: string; onClose: () => void; onDone: (temp: { name: string; pw: string } | null) => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", phone: "", email: "", bankAccount: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const err = (k: string) => (errors[k] ? <div className="field-error">{errors[k]}</div> : null);
  const submit = () => start(async () => {
    const r = await registerShipperAction(code, f);
    if (r.ok) { toast(r.message ?? "등록했습니다"); onDone(r.data?.tempPassword ? { name: f.name, pw: r.data.tempPassword } : null); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error); }
  });
  return (
    <Modal title="선주 등록" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className="btn-primary" onClick={submit} disabled={pending}>{pending ? <span className="spinner" /> : "등록"}</button></>}>
      <div className="form-grid">
        <div className="field"><label>이름 *</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="박선주" autoFocus />{err("name")}</div>
        <div className="field"><label>전화 *</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="010-0000-0000" />{err("phone")}</div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label>이메일</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />{err("email")}</div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label>정산 계좌</label><input value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} placeholder="수협 123-4567-8901 박선주" />{err("bankAccount")}</div>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>전화/이메일이 기존 사용자와 일치하면 그 계정에 선주 역할을 추가합니다. 신규 사용자는 임시 비밀번호가 발급되며 첫 로그인 시 본인 인증(OTP)을 진행합니다.</p>
    </Modal>
  );
}

function VesselModal({ code, shipper, onClose, onDone }: { code: string; shipper: ShipperItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", registrationNo: "" });
  const submit = () => start(async () => {
    const r = await createVesselAction(code, { name: f.name, registrationNo: f.registrationNo, shipperUserId: shipper.userId });
    toast(r.ok ? r.message ?? "등록했습니다" : r.error);
    if (r.ok) onDone();
  });
  return (
    <Modal title={`${shipper.name} · 선박 추가`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className="btn-primary" onClick={submit} disabled={pending || f.name.trim().length < 2}>{pending ? <span className="spinner" /> : "추가"}</button></>}>
      <div className="form-grid">
        <div className="field"><label>선박명 *</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="제1만선호" autoFocus /></div>
        <div className="field"><label>등록번호</label><input value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} placeholder="YD-1234" /></div>
      </div>
    </Modal>
  );
}

function EditShipperModal({ code, shipper, onClose, onDone }: { code: string; shipper: ShipperItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ phone: shipper.phone ?? "", bankAccount: shipper.bankAccount ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => start(async () => {
    const r = await updateShipperAction(code, shipper.userId, f);
    if (r.ok) { toast(r.message ?? "수정했습니다"); onDone(); } else { setErrors(r.fieldErrors ?? {}); toast(r.error); }
  });
  return (
    <Modal title={`${shipper.name} · 정보 수정`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className="btn-primary" onClick={submit} disabled={pending}>{pending ? <span className="spinner" /> : "저장"}</button></>}>
      <div className="form-grid">
        <div className="field"><label>전화</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />{errors.phone && <div className="field-error">{errors.phone}</div>}</div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label>정산 계좌</label><input value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} placeholder="비우면 삭제" />{errors.bankAccount && <div className="field-error">{errors.bankAccount}</div>}</div>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>이름·이메일 변경은 본인 인증이 필요하여 현재 지원하지 않습니다.</p>
    </Modal>
  );
}
