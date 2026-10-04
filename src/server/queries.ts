import { db } from "./db";
import {
  publicListing,
  kstDay,
  groupMarket,
  type User,
  type Listing,
  type BuyRequest,
  type Warehouse,
  type Notification,
  type MarketGroup,
} from "../lib/model";
export async function taxonomy() {
  const rows =
    await db()`SELECT kind,name FROM taxonomy WHERE active ORDER BY name`;
  return {
    regions: rows
      .filter((x) => x.kind === "region")
      .map((x) => x.name as string),
    species: rows
      .filter((x) => x.kind === "species")
      .map((x) => x.name as string),
  };
}
export async function listings(
  user: User | null,
  filters: {
    region?: string;
    species?: string;
    state?: string;
    q?: string;
    own?: boolean;
    saved?: boolean;
    ownerId?: string;
    page?: number;
  } = {},
) {
  const sql = db();
  const rows = await sql<
    Listing[]
  >`SELECT l.*,jsonb_build_object('name',m.profile->>'name','business',m.profile->>'business','hours',m.profile->>'hours','contact',m.profile->>'contact') AS seller FROM listings l JOIN members m ON m.id=l.owner_id WHERE NOT l.hidden AND NOT m.suspended AND m.role='broker' AND (${!!filters.own} OR (l.closed_at IS NULL AND l.expires_at>now())) AND (${!filters.own} OR l.owner_id=${user?.id || null}) AND (${!filters.ownerId} OR l.owner_id=${filters.ownerId || null}) AND (${!filters.saved} OR EXISTS(SELECT 1 FROM favorites f WHERE f.listing_id=l.id AND f.user_id=${user?.id || null})) AND (${!filters.region} OR l.data->>'region' ILIKE ${"%" + (filters.region || "") + "%"}) AND (${!filters.species} OR l.data->>'species'=${filters.species || ""}) AND (${!filters.state} OR l.data->>'state'=${filters.state || ""}) AND (${!filters.q} OR concat(l.data->>'species',' ',l.data->>'market',' ',l.data->>'grade',' ',m.profile->>'business') ILIKE ${"%" + (filters.q || "") + "%"}) ORDER BY l.created_at DESC LIMIT 60 OFFSET ${Math.min(1000, Math.max(0, Number.isFinite(filters.page) ? Math.floor(filters.page || 1) - 1 : 0)) * 60}`;
  return rows.map((x) => publicListing(x, !!user));
}
export async function listing(id: string, user: User | null) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const rows = await db()<
    Listing[]
  >`SELECT l.*,jsonb_build_object('name',m.profile->>'name','business',m.profile->>'business','hours',m.profile->>'hours','contact',m.profile->>'contact') AS seller FROM listings l JOIN members m ON m.id=l.owner_id WHERE l.id=${id} AND NOT l.hidden AND NOT m.suspended AND m.role='broker'`;
  return rows[0] ? publicListing(rows[0], !!user) : null;
}
export async function requests(user: User | null, own = false) {
  if (!user) return [];
  const rows = await db()<
    BuyRequest[]
  >`SELECT r.*,m.profile->>'business' AS business,m.profile->>'contact' AS contact FROM buy_requests r JOIN members m ON m.id=r.owner_id WHERE NOT r.hidden AND NOT m.suspended AND m.role='buyer' AND (${own} OR (r.closed_at IS NULL AND r.data->>'deadline'>=${kstDay()})) AND (${!own} OR r.owner_id=${user?.id || null}) ORDER BY r.created_at DESC LIMIT 100`;
  return rows.map((r) => ({ ...r, contact: user ? r.contact : undefined }));
}
export async function warehouses(user: User | null) {
  const rows = await db()<
    Warehouse[]
  >`SELECT w.*,m.profile->>'business' AS business,m.profile->>'contact' AS contact FROM warehouses w JOIN members m ON m.id=w.owner_id WHERE NOT w.hidden AND NOT m.suspended AND m.role='storage' ORDER BY w.created_at DESC LIMIT 100`;
  return rows.map((w) => ({
    ...w,
    contact: user ? w.contact : undefined,
    data: user ? w.data : { ...w.data, address: w.data.region },
  }));
}
export async function broker(id: string, user: User | null) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await db()<
    User[]
  >`SELECT * FROM members WHERE id=${id} AND role='broker' AND NOT suspended`;
  if (!row) return null;
  const {
    name,
    business,
    region,
    market,
    bio,
    hours,
    specialties,
    procurement,
    contact,
  } = row.profile;
  return {
    id: row.id,
    demo: row.demo,
    profile: {
      name,
      business,
      region,
      market,
      bio,
      hours,
      specialties,
      procurement,
      ...(user && !row.demo ? { contact } : {}),
    },
  };
}
export async function notifications(user: User) {
  return await db()<
    Notification[]
  >`SELECT id,title,body,href,read_at,created_at FROM notifications WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 100`;
}
export async function unread(user: User | null) {
  if (!user) return 0;
  const [r] =
    await db()`SELECT count(*)::int AS n FROM notifications WHERE user_id=${user.id} AND read_at IS NULL`;
  return r.n as number;
}
export async function market(
  day = kstDay(),
  region = "",
): Promise<{ groups: MarketGroup[]; official: Record<string, unknown>[] }> {
  const sql = db();
  const rows = await sql<
    Listing[]
  >`SELECT l.* FROM listings l JOIN members m ON m.id=l.owner_id WHERE (l.created_at AT TIME ZONE 'Asia/Seoul')::date=${day}::date AND NOT l.hidden AND NOT m.suspended AND m.role='broker' AND (${!region} OR l.data->>'region' ILIKE ${"%" + region + "%"})`;
  const official =
    await sql`SELECT *,basis_day::text AS basis_day FROM official_prices WHERE basis_day=${day}::date AND (${!region} OR region ILIKE ${"%" + region + "%"}) ORDER BY region,species LIMIT 100`;
  return { groups: groupMarket(rows), official };
}
export async function adminData() {
  const sql = db();
  const [members, reports, audit, activity, pendingContent, official] =
    await Promise.all([
      sql`SELECT id,phone,role,profile,suspended,admin FROM members ORDER BY created_at DESC LIMIT 150`,
      sql`SELECT r.*,m.profile->>'business' AS reporter FROM reports r JOIN members m ON m.id=r.user_id ORDER BY created_at DESC LIMIT 100`,
      sql`SELECT a.*,m.profile->>'name' AS actor FROM audit_log a LEFT JOIN members m ON m.id=a.actor_id ORDER BY a.created_at DESC LIMIT 80`,
      sql`SELECT day::text AS day,count(DISTINCT user_id) FILTER(WHERE kind='visit')::int AS visitors,count(*) FILTER(WHERE kind='contact')::int AS contacts,(SELECT count(*) FROM listings l WHERE (l.created_at AT TIME ZONE 'Asia/Seoul')::date=a.day AND NOT l.demo)::int AS listings FROM activity a GROUP BY day ORDER BY day DESC LIMIT 14`,
      sql`SELECT id,'listing' AS kind,data->>'species' AS title,hidden FROM listings UNION ALL SELECT id,'request',data->>'species',hidden FROM buy_requests UNION ALL SELECT id,'storage',data->>'name',hidden FROM warehouses LIMIT 200`,
      sql`SELECT * FROM official_prices ORDER BY verified_at DESC LIMIT 50`,
    ]);
  return {
    members,
    reports,
    audit,
    activity,
    content: pendingContent,
    official,
  };
}
