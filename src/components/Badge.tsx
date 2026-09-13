export function Badge({ tone, children }: { tone: "success" | "danger" | "warning" | "info" | "muted"; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function StatusBadge<T extends string>({ map, value }: { map: Record<T, { label: string; badge: "success" | "danger" | "warning" | "info" | "muted" }>; value: T }) {
  const m = map[value] ?? { label: value, badge: "muted" as const };
  return <Badge tone={m.badge}>{m.label}</Badge>;
}
