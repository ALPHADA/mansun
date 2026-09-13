"use client";
import { useState } from "react";
import Link from "next/link";
import { NavLink } from "./NavLink";
import { logoutAction } from "@/app/(auth)/actions";

export interface NavItem { href: string; icon: string; label: string; exact?: boolean }

export function SidebarShell({ brandTag, nav, userLine, tenantSlot, title, meta, banner, children, homeHref }:
  { brandTag: string; nav: NavItem[]; userLine: React.ReactNode; tenantSlot?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; banner?: React.ReactNode; children: React.ReactNode; homeHref: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-layout">
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-brand"><Link href={homeHref} style={{ color: "inherit" }}>🐟 MANSUN</Link> <span className="brand-tag">{brandTag}</span></div>
        {tenantSlot && <div style={{ padding: "10px 18px", borderBottom: "1px solid #1e293b" }}>{tenantSlot}</div>}
        <ul className="sidebar-nav" onClick={() => setOpen(false)}>
          {nav.map((n) => <li key={n.href}><NavLink href={n.href} icon={n.icon} exact={n.exact}>{n.label}</NavLink></li>)}
        </ul>
        <div className="sidebar-user">
          {userLine}<br />
          <form action={logoutAction} style={{ display: "inline" }}><button className="btn-ghost" style={{ padding: 0, fontSize: 12, color: "#94a3b8" }}>로그아웃</button></form>
        </div>
      </aside>
      <div className={`sidebar-backdrop${open ? " show" : ""}`} onClick={() => setOpen(false)} />
      <main className="main">
        {banner}
        <div className="topbar">
          <button className="hamburger" aria-label="메뉴 열기" type="button" onClick={() => setOpen(true)}>☰</button>
          <h1>{title}</h1>
          <div className="meta">{meta}</div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
