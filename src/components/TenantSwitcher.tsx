"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/app/(auth)/actions";
import type { MembershipSummary } from "@/services/auth";
import { ROLE_LABEL } from "@/lib/authz/matrix";

export function TenantSwitcher({ current, memberships, isPlatformAdmin, light }:
  { current: { code: string; name: string } | null; memberships: MembershipSummary[]; isPlatformAdmin: boolean; light?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const multi = memberships.length + (isPlatformAdmin ? 1 : 0) > 1;
  const label = current ? current.name : "Platform";
  if (!multi) return <span className={`tenant-chip${light ? " light" : ""}`} style={{ cursor: "default" }}>🏢 {label}</span>;

  const go = (code: string) => {
    const dirty = document.querySelector("form[data-dirty='true']");
    if (dirty && !confirm("작성 중인 내용이 있습니다. 수협을 전환하면 사라집니다. 계속할까요?")) return;
    start(async () => {
      const r = await switchTenantAction(code);
      if (r.ok && r.data) router.push(r.data.next);
      setOpen(false);
    });
  };
  return (
    <div className="dropdown">
      <button type="button" className={`tenant-chip${light ? " light" : ""}`} onClick={() => setOpen((o) => !o)} disabled={pending}>
        🏢 {label} ▾
      </button>
      {open && (
        <div className="dropdown-menu">
          {memberships.map((m) => (
            <button key={m.tenantId} type="button" className={current?.code === m.tenantCode ? "current" : undefined} onClick={() => go(m.tenantCode)}>
              {m.tenantName} <span className="muted small">· {m.roles.map((r) => ROLE_LABEL[r]).join("/")}</span>
            </button>
          ))}
          {isPlatformAdmin && <button type="button" className={!current ? "current" : undefined} onClick={() => go("platform")}>🛠 Platform Console</button>}
          <a href="/select-tenant">다른 수협 보기 →</a>
        </div>
      )}
    </div>
  );
}
