"use client";
import { useState } from "react";
import type { NoticeTarget, NotificationChannel } from "@/db/schema";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useAction } from "../_components/useAction";
import { sendNoticeAction } from "./actions";

interface Props {
  code: string; canSend: boolean; fieldEnabled: boolean; bufferMin: number;
  round: { id: string; label: string; status: string; statusLabel: string; bidStartAt: string; bidCloseAt: string; fieldStartAt: string; autoNoticedAt: string | null };
  autoNoticeAt: string | null;
  lastAuto: { title: string; sentAt: string; recipients: number } | null;
  lotCount: number;
  counts: Record<NoticeTarget, number>;
  defaultTitle: string; defaultMessage: string; tenantName: string;
}
const TARGETS: { key: NoticeTarget; label: string; note?: string }[] = [
  { key: "broker", label: "중매인" }, { key: "union", label: "노조" }, { key: "staff", label: "수협 직원" }, { key: "shipper", label: "선주", note: "참고용" },
];
const CHANNELS: { key: NotificationChannel; label: string; note?: string; locked?: boolean }[] = [
  { key: "inapp", label: "인앱 푸시", locked: true }, { key: "kakao", label: "카카오 알림톡" }, { key: "sms", label: "SMS", note: "백업" }, { key: "email", label: "이메일" },
];

export function NoticeForm({ code, canSend, fieldEnabled, bufferMin, round, autoNoticeAt, lastAuto, lotCount, counts, defaultTitle, defaultMessage }: Props) {
  const { busy, call, toast } = useAction();
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [form, setForm] = useState({ title: defaultTitle, message: defaultMessage, bidStartAt: round.bidStartAt, bidCloseAt: round.bidCloseAt, fieldStartAt: round.fieldStartAt });
  const [targets, setTargets] = useState<NoticeTarget[]>(["broker", "union", "staff"]);
  const [channels, setChannels] = useState<NotificationChannel[]>(["inapp", "kakao"]);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const recipients = targets.reduce((s, t) => s + counts[t], 0);
  const closed = round.status === "done" || round.status === "cancelled";

  const toggle = <T,>(list: T[], v: T, set: (l: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const send = async () => {
    const r = await call(sendNoticeAction(code, { roundId: round.id, ...form, fieldStartAt: fieldEnabled ? form.fieldStartAt || null : null, targets, channels }), { silent: true });
    setConfirm(false);
    if (r.ok) toast(`✅ 공지 발송 완료 · ${r.data.recipientCount}명 (성공 ${r.data.successCount} / 실패 ${r.data.failCount})`);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>공지 작성 <span className="muted small">{round.label} · {round.statusLabel}</span></h2>
        <div className="toggle-row">
          <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>수동</button>
          <button type="button" className={mode === "auto" ? "active" : ""} onClick={() => setMode("auto")}>자동 스케줄</button>
        </div>
      </div>
      <div className="panel-body">
        {mode === "auto" ? (
          <div className="info-box">
            <p><strong>자동 공지 시각:</strong> {autoNoticeAt ? `매일 ${autoNoticeAt} (회차 시간표 기준, 스케줄러가 발송)` : "이 회차에는 자동 공지가 설정되어 있지 않습니다"}</p>
            <p><strong>이번 회차 자동 발송:</strong> {round.autoNoticedAt ?? "아직 발송되지 않음"}</p>
            <p><strong>최근 자동 공지:</strong> {lastAuto ? `${lastAuto.sentAt} · ${lastAuto.title} · ${lastAuto.recipients}명` : "없음"}</p>
            <p className="small">자동 공지 대상은 중매인·노조·수협 직원, 채널은 수협 알림 설정을 따릅니다. 시각 변경은 수협 관리자 → 경매 일정에서 합니다.</p>
          </div>
        ) : (
          <>
            {closed && <div className="notice-box">⚠️ 종료된 회차에는 공지를 발송할 수 없습니다.</div>}
            {lotCount === 0 && !closed && <div className="notice-box">ℹ️ 이 회차에 확정된 품목이 없습니다. 공지는 발송되지만 품목 0건으로 안내됩니다.</div>}
            <div className="form-row">
              <div style={{ flex: 1 }}><label>공지 제목 * <span className="muted">(2~40자)</span></label><input value={form.title} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} disabled={!canSend} /></div>
            </div>
            <div className="form-row">
              <div style={{ flex: 1 }}><label>입찰 시작 *</label><input type="datetime-local" value={form.bidStartAt} onChange={(e) => setForm((f) => ({ ...f, bidStartAt: e.target.value }))} disabled={!canSend} /></div>
              <div style={{ flex: 1 }}><label>입찰 마감 *</label><input type="datetime-local" value={form.bidCloseAt} onChange={(e) => setForm((f) => ({ ...f, bidCloseAt: e.target.value }))} disabled={!canSend} /></div>
              {fieldEnabled && <div style={{ flex: 1 }}><label>현장 경매 시작 (Phase 2) <span className="muted">마감 +{bufferMin}분 이후</span></label><input type="datetime-local" value={form.fieldStartAt} onChange={(e) => setForm((f) => ({ ...f, fieldStartAt: e.target.value }))} disabled={!canSend} /></div>}
            </div>
            <div>
              <label>발송 대상 * <span className="muted">총 {recipients}명</span></label>
              <div className="checkbox-row">
                {TARGETS.map((t) => (
                  <label key={t.key}><input type="checkbox" checked={targets.includes(t.key)} onChange={() => toggle(targets, t.key, setTargets)} disabled={!canSend} /> {t.label} ({counts[t.key]}명{t.note ? `, ${t.note}` : ""})</label>
                ))}
              </div>
            </div>
            <div className="mt-16">
              <label>발송 채널 *</label>
              <div className="checkbox-row">
                {CHANNELS.map((c) => (
                  <label key={c.key}><input type="checkbox" checked={channels.includes(c.key)} disabled={c.locked || !canSend} onChange={() => toggle(channels, c.key, setChannels)} /> {c.label}{c.note ? ` (${c.note})` : ""}{c.locked ? " (항상)" : ""}</label>
                ))}
              </div>
            </div>
            <div className="mt-16">
              <label>안내 메시지 * <span className="muted">({form.message.trim().length}/500)</span></label>
              <textarea rows={4} style={{ resize: "vertical" }} value={form.message} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} disabled={!canSend} />
            </div>
            <div className="form-actions">
              <button className="btn-secondary" type="button" onClick={() => setPreview(true)}>미리보기</button>
              {canSend && <button className="btn-primary" type="button" onClick={() => setConfirm(true)} disabled={busy || closed || targets.length === 0 || channels.length === 0}>📤 공지 발송</button>}
            </div>
          </>
        )}
      </div>

      {preview && (
        <Modal title="공지 미리보기" onClose={() => setPreview(false)} footer={<button className="btn-secondary" type="button" onClick={() => setPreview(false)}>닫기</button>}>
          <div className="kv" style={{ marginBottom: 12 }}>
            <dt>제목</dt><dd><strong>{form.title || "(제목 없음)"}</strong></dd>
            <dt>대상</dt><dd>{targets.map((t) => TARGETS.find((x) => x.key === t)?.label).join(", ") || "-"} · {recipients}명</dd>
            <dt>채널</dt><dd>{channels.map((c) => CHANNELS.find((x) => x.key === c)?.label).join(", ")}</dd>
          </div>
          <div className="notice-preview">{form.message}</div>
        </Modal>
      )}
      {confirm && (
        <ConfirmModal title="공지 발송" confirmLabel="발송" busy={busy} onClose={() => setConfirm(false)} onConfirm={send}
          message={<><strong>{recipients}명</strong>에게 발송합니다. ({targets.map((t) => TARGETS.find((x) => x.key === t)?.label).join(", ")} · {channels.map((c) => CHANNELS.find((x) => x.key === c)?.label).join(", ")})<br /><span className="muted small">회차 시간이 변경된 경우 함께 저장되며, 품목 상태가 공지됨/입찰중으로 전환됩니다.</span></>} />
      )}
    </div>
  );
}
