import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";

export async function NotificationBell({ userId, href, light }: { userId: string; href: string; light?: boolean }) {
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return (
    <Link href={href} className="bell" style={light ? { color: "#cbd5e1" } : undefined} aria-label="알림">
      🔔{n > 0 && <span className="badge-count">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
