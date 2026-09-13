"use client";
import { useEffect } from "react";

export function Modal({ title, children, footer, onClose }: { title: string; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = "확인", danger, onConfirm, onClose, busy, children }:
  { title: string; message?: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean; children?: React.ReactNode }) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
        <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={busy}>{busy ? <span className="spinner" /> : confirmLabel}</button>
      </>
    }>
      {message && <p style={{ marginTop: 0 }}>{message}</p>}
      {children}
    </Modal>
  );
}
