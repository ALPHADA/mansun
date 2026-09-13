"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { TenantStatus } from "@/db/schema";
import type { AdminInviteInput, StatusNotifyTarget, SuspendDuration } from "@/services/platform";
import { enterReadModeAction, reinviteAdminAction, tenantStatusAction } from "./actions";

type Kind = "activate" | "suspend" | "unsuspend" | "archive" | "reinvite" | "read";
interface Props { code: string; name: string; status: TenantStatus; adminActiveCount: number; defaultAdmin?: { name: string; email: string; phone?: string | null; title?: string | null } | null }

export function TenantActions({ code, name, status, adminActiveCount, defaultAdmin }: Props) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const close = () => setOpen(null);

  const runStatus = (action: "activate" | "suspend" | "unsuspend" | "archive", opts: { reason?: string; duration?: SuspendDuration; notifyTarget?: StatusNotifyTarget }, onError: (m: string) => void) =>
    start(async () => {
      const r = await tenantStatusAction(code, action, opts);
      if (!r.ok) { onError(r.error); return; }
      toast(r.message ?? "완료");
      close();
      router.refresh();
    });

  return (
    <>
      <div className="action-row">
        {status === "pending" && <button className="btn-primary" onClick={() => setOpen("activate")}>✅ 활성화</button>}
        {status === "active" && <button className="btn-warning" onClick={() => setOpen("suspend")}>⚠ 정지</button>}
        {status === "suspended" && <button className="btn-primary" onClick={() => setOpen("unsuspend")}>▶ 정지 해제</button>}
        {(status === "active" || status === "suspended") && <button className="btn-danger" onClick={() => setOpen("archive")}>⚠ 아카이브</button>}
        {status !== "archived" && <button className="btn-secondary" onClick={() => setOpen("reinvite")}>✉ 초기 Admin 재초청</button>}
        <button className="btn-secondary" onClick={() => setOpen("read")}>🔍 분쟁 조회 모드로 진입</button>
      </div>

      {open === "activate" && (
        <ConfirmModal title="수협 활성화" confirmLabel="활성화" busy={pending} onClose={close}
          onConfirm={() => runStatus("activate", { notifyTarget: "admin" }, toast)}
          message={<>“{name}” 을(를) <b>운영중(active)</b> 상태로 전환합니다. 입고·입찰·개찰·정산 기능이 열리고 수협 Admin 에게 활성화 알림(이메일)이 발송됩니다.</>}>
          {adminActiveCount < 1
            ? <div className="danger-box">활성 상태의 수협 Admin 이 없습니다. 초기 Admin 이 초청을 수락한 뒤에 활성화할 수 있습니다.</div>
            : <div className="small muted">활성 Admin {adminActiveCount}명 확인됨</div>}
        </ConfirmModal>
      )}
      {open === "suspend" && <SuspendModal name={name} busy={pending} onClose={close} onSubmit={(o, onErr) => runStatus("suspend", o, onErr)} />}
      {open === "unsuspend" && <UnsuspendModal name={name} busy={pending} onClose={close} onSubmit={(o, onErr) => runStatus("unsuspend", o, onErr)} />}
      {open === "archive" && <ArchiveModal name={name} busy={pending} onClose={close} onSubmit={(o, onErr) => runStatus("archive", o, onErr)} />}
      {open === "reinvite" && <ReinviteModal code={code} name={name} initial={defaultAdmin ?? null} onClose={close} />}
      {open === "read" && <ReadModeModal code={code} name={name} onClose={close} />}
    </>
  );
}

function ReasonField({ value, onChange, min, label = "사유", placeholder }: { value: string; onChange: (v: string) => void; min: number; label?: string; placeholder?: string }) {
  const bad = value.trim().length < min;
  return (
    <div className="modal-field">
      <label>{label} <span className="text-danger">*</span> <span className="muted">({min}자 이상)</span></label>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <div className={`count${bad ? " bad" : ""}`}>{value.trim().length}/{min}</div>
    </div>
  );
}

type StatusSubmit = (opts: { reason?: string; duration?: SuspendDuration; notifyTarget?: StatusNotifyTarget }, onError: (m: string) => void) => void;

function SuspendModal({ name, busy, onClose, onSubmit }: { name: string; busy: boolean; onClose: () => void; onSubmit: StatusSubmit }) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<SuspendDuration>("30d");
  const [target, setTarget] = useState<StatusNotifyTarget>("admin");
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 10;
  return (
    <Modal title="⚠ 수협 정지" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
      <button className="btn-danger" disabled={!ok || busy} onClick={() => onSubmit({ reason, duration, notifyTarget: target }, setError)}>{busy ? <span className="spinner" /> : "정지"}</button>
    </>}>
      <div className="warn-box">“{name}” 의 신규 입고·입찰·개찰·정산이 즉시 차단됩니다. 사용자 로그인과 조회는 가능합니다. 이 작업은 감사 로그에 기록됩니다.</div>
      {error && <div className="form-error">{error}</div>}
      <ReasonField value={reason} onChange={setReason} min={10} placeholder="예: 체납 정산 미해결 (2026-08 회차 3건)" />
      <div className="modal-field">
        <label>정지 기간 <span className="text-danger">*</span></label>
        <div className="radio-row">
          {(["7d", "30d", "indefinite"] as SuspendDuration[]).map((d) => (
            <label key={d}><input type="radio" name="duration" checked={duration === d} onChange={() => setDuration(d)} /> {d === "7d" ? "7일" : d === "30d" ? "30일" : "무기한"}</label>
          ))}
        </div>
        <div className="muted small mt-8">기간은 안내용이며 자동 해제되지 않습니다 — 해제는 Platform Admin 이 명시적으로 실행합니다.</div>
      </div>
      <div className="modal-field">
        <label>통지 대상</label>
        <div className="radio-row">
          {(["all", "admin", "none"] as StatusNotifyTarget[]).map((t) => (
            <label key={t}><input type="radio" name="target" checked={target === t} onChange={() => setTarget(t)} /> {t === "all" ? "모든 멤버" : t === "admin" ? "Admin 만" : "없음"}</label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function UnsuspendModal({ name, busy, onClose, onSubmit }: { name: string; busy: boolean; onClose: () => void; onSubmit: StatusSubmit }) {
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<StatusNotifyTarget>("admin");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="정지 해제" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
      <button className="btn-primary" disabled={busy} onClick={() => onSubmit({ reason, notifyTarget: target }, setError)}>{busy ? <span className="spinner" /> : "정지 해제"}</button>
    </>}>
      <p style={{ marginTop: 0 }}>“{name}” 을(를) <b>운영중(active)</b> 으로 복귀시킵니다. 미해결 분쟁 종결·체납 정산 완료·면허 갱신 확인 등 해제 근거를 남겨주세요.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-field"><label>해제 근거 (선택)</label><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 2026-09 체납 정산 입금 확인" /></div>
      <div className="modal-field">
        <label>통지 대상</label>
        <div className="radio-row">
          {(["all", "admin", "none"] as StatusNotifyTarget[]).map((t) => (
            <label key={t}><input type="radio" name="target" checked={target === t} onChange={() => setTarget(t)} /> {t === "all" ? "모든 멤버" : t === "admin" ? "Admin 만" : "없음"}</label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function ArchiveModal({ name, busy, onClose, onSubmit }: { name: string; busy: boolean; onClose: () => void; onSubmit: StatusSubmit }) {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 10 && ack;
  return (
    <Modal title="⚠ 수협 아카이브" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
      <button className="btn-danger" disabled={!ok || busy} onClick={() => onSubmit({ reason, notifyTarget: "admin" }, setError)}>{busy ? <span className="spinner" /> : "아카이브"}</button>
    </>}>
      <div className="danger-box">아카이브는 <b>되돌릴 수 없습니다</b>. “{name}” 은(는) 영업 종료 상태가 되어 모든 운영 기능과 신규 Membership 이 차단되고 읽기 전용으로만 남습니다.</div>
      <div className="small muted mb-8">데이터는 삭제되지 않으며 법적 보존 기간(입찰·낙찰·정산·감사 로그: 영구 / 개인정보: 아카이브 후 5년, 확정 필요) 동안 읽기 전용으로 유지됩니다. 보존 기간 종료 후 처리는 별도 정책입니다.</div>
      {error && <div className="form-error">{error}</div>}
      <ReasonField value={reason} onChange={setReason} min={10} placeholder="예: 2026-12-31 위판장 영업 종료 (수협 공문 제2026-118호)" />
      <div className="checkbox-row"><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> 되돌릴 수 없음을 확인했습니다</label></div>
    </Modal>
  );
}

function ReinviteModal({ code, name, initial, onClose }: { code: string; name: string; initial: { name: string; email: string; phone?: string | null; title?: string | null } | null; onClose: () => void }) {
  const [form, setForm] = useState<AdminInviteInput>({ name: initial?.name ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "", title: initial?.title ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ inviteLink: string; email: string } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const set = (k: keyof AdminInviteInput) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => start(async () => {
    const r = await reinviteAdminAction(code, { ...form, phone: form.phone?.trim() || undefined, title: form.title?.trim() || undefined });
    if (!r.ok) { setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] ?? r.error : r.error); return; }
    toast(r.message ?? "발송됨");
    if (r.data) setDone(r.data);
    router.refresh();
  });
  return (
    <Modal title="초기 Admin 재초청" onClose={onClose} footer={done
      ? <button className="btn-primary" onClick={onClose}>닫기</button>
      : <><button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button><button className="btn-primary" onClick={submit} disabled={pending}>{pending ? <span className="spinner" /> : "초청 메일 발송"}</button></>}>
      {done ? (
        <div className="success-box">
          <h3>✉ {done.email} 에게 초청 메일을 발송했습니다</h3>
          <div className="small muted mb-8">7일 유효 · 같은 이메일의 기존 미수락 초청은 만료 처리되었습니다.</div>
          {process.env.NODE_ENV !== "production" && <div className="invite-link"><a href={done.inviteLink} target="_blank" rel="noreferrer">{window.location.origin}{done.inviteLink}</a></div>}
        </div>
      ) : (
        <>
          <p style={{ marginTop: 0 }} className="small muted">“{name}” 의 수협 Admin 으로 가입할 대상에게 1회용 링크(7일 유효)를 보냅니다. 초청 만료·이메일 오기재 시 사용하세요.</p>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <div className="modal-field"><label>이름 *</label><input value={form.name} onChange={set("name")} /></div>
            <div className="modal-field"><label>이메일 *</label><input type="email" value={form.email} onChange={set("email")} /></div>
            <div className="modal-field"><label>전화번호</label><input type="tel" value={form.phone ?? ""} onChange={set("phone")} placeholder="010-0000-0000" /></div>
            <div className="modal-field"><label>직책</label><input value={form.title ?? ""} onChange={set("title")} placeholder="위판과장" /></div>
          </div>
        </>
      )}
    </Modal>
  );
}

function ReadModeModal({ code, name, onClose }: { code: string; name: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const ok = reason.trim().length >= 20;
  const submit = () => start(async () => {
    const r = await enterReadModeAction(code, reason);
    if (!r.ok) { setError(r.error); return; }
    toast(r.message ?? "진입");
    if (r.data) router.push(r.data.next);
  });
  return (
    <Modal title="🔍 분쟁 조회 모드 진입" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose} disabled={pending}>취소</button>
      <button className="btn-primary" disabled={!ok || pending} onClick={submit}>{pending ? <span className="spinner" /> : "사유 기록 후 진입"}</button>
    </>}>
      <div className="warn-box">“{name}” 의 입고·입찰·낙찰·정산 데이터를 <b>읽기 전용</b>으로 조회합니다. 진입 사유가 감사 로그에 기록되고 수협 Admin 에게 조회 사실이 통지됩니다. 세션은 4시간 후 만료됩니다.</div>
      {error && <div className="form-error">{error}</div>}
      <ReasonField value={reason} onChange={setReason} min={20} label="조회 사유" placeholder="예: 민원 #M-2026-0042 — 9/12 1회차 T-01 고등어 입찰 이력 확인" />
    </Modal>
  );
}
