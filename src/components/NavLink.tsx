"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, icon, children, exact }: { href: string; icon?: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={active ? "active" : undefined}>
      {icon && <span className="nav-icon">{icon}</span>} {children}
    </Link>
  );
}
export function TabLink({ href, icon, label, exact }: { href: string; icon: string; label: string; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={active ? "active" : undefined}>
      <span className="tab-icon">{icon}</span>{label}
    </Link>
  );
}
