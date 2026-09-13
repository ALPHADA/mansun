import Link from "next/link";
import { TabLink } from "./NavLink";

export interface TabItem { href: string; icon: string; label: string; exact?: boolean }

export function MobileShell({ title, tabs, right, backHref, banner, children }:
  { title: React.ReactNode; tabs: TabItem[]; right?: React.ReactNode; backHref?: string; banner?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mobile-frame">
      {banner}
      <header className="mobile-header">
        <div className="flex">
          {backHref && <Link href={backHref} className="back-btn" aria-label="뒤로">‹</Link>}
          <h1>{title}</h1>
        </div>
        <div className="flex">{right}</div>
      </header>
      <div className="mobile-content">{children}</div>
      <nav className="bottom-tabs">
        {tabs.map((t) => <TabLink key={t.href} {...t} />)}
      </nav>
    </div>
  );
}
