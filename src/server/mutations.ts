import { z } from "zod";
import { db } from "./db";
import { AppError, requireAdmin } from "./auth";
import {
  listingSchema,
  requestSchema,
  storageSchema,
  profileSchema,
  endOfDay,
  kstDay,
  type User,
  type Listing,
  type ListingData,
} from "../lib/model";
const uuid = z.string().uuid();
export async function mutate(user: User, path: string, input: unknown) {
  const sql = db();
  const body = z.record(z.string(), z.unknown()).parse(input);
  const id = () => uuid.parse(body.id);
  if (path === "profile") {
    const p = profileSchema.parse(body);
    if (user.role === "broker" && (!p.market || !p.license))
      throw new AppError("소속 위판장과 중매인 번호를 입력해주세요.");
    if (user.phone && p.contact !== user.phone)
      throw new AppError("업무 연락처는 인증된 휴대폰 번호를 사용해주세요.");
    const recheck =
      user.role === "broker" &&
      (p.license !== user.profile.license ||
        p.market !== user.profile.market ||
        p.business !== user.profile.business);
    await sql.begin(async (tx) => {
      await tx`UPDATE members SET profile=${tx.json(p)},approval=${recheck ? "pending" : user.approval} WHERE id=${user.id}`;
      await tx`INSERT INTO audit_log(actor_id,action,target) VALUES(${user.id},'profile.update',${user.id})`;
    });
    return { ok: true };
  }
  if (path === "listings") {
    if (user.role !== "broker" || user.approval !== "approved")
      throw new AppError("승인된 중매인만 물건을 등록할 수 있습니다.", 403);
    const data = listingSchema.parse(body);
    const existingId = body.id ? uuid.parse(body.id) : null;
    return await sql.begin(async (tx) => {
      for (const photo of data.photos) {
        const [asset] =
          await tx`SELECT id FROM assets WHERE id=${photo.split("/").pop()!} AND owner_id=${user.id}`;
        if (!asset) throw new AppError("직접 업로드한 사진을 선택해주세요.");
      }
      let result: Listing;
      if (existingId) {
        const [old] = await tx<
          Listing[]
        >`SELECT * FROM listings WHERE id=${existingId} AND owner_id=${user.id} FOR UPDATE`;
        if (
          !old ||
          old.hidden ||
          old.closed_at ||
          new Date(old.expires_at) < new Date()
        )
          throw new AppError(
            "수정할 수 없는 상품입니다. 새 글로 등록해주세요.",
            403,
          );
        [result] = await tx<
          Listing[]
        >`UPDATE listings SET data=${tx.json(data)},updated_at=now() WHERE id=${existingId} RETURNING *`;
      } else {
        [result] = await tx<
          Listing[]
        >`INSERT INTO listings(owner_id,data,expires_at,demo) VALUES(${user.id},${tx.json(data)},${endOfDay()},${user.demo}) RETURNING *`;
      }
      await tx`INSERT INTO price_history(listing_id,data,actor_id) VALUES(${result.id},${tx.json(data)},${user.id})`;
      await tx`INSERT INTO audit_log(actor_id,action,target) VALUES(${user.id},${existingId ? "listing.update" : "listing.create"},${result.id})`;
      return { id: result.id };
    });
  }
  if (path === "listings/close") {
    const [row] =
      await sql`UPDATE listings SET closed_at=now(),updated_at=now() WHERE id=${id()} AND owner_id=${user.id} RETURNING id`;
    if (!row) throw new AppError("내 상품만 마감할 수 있습니다.", 403);
    return { ok: true };
  }
  if (path === "requests") {
    if (user.role !== "buyer")
      throw new AppError("매입회원만 매입 요청을 등록할 수 있습니다.", 403);
    const data = requestSchema.parse(body);
    for (const d of [data.deadline, data.receiveDate])
      if (
        Number.isNaN(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d
      )
        throw new AppError("날짜를 확인해주세요.");
    if (data.deadline < kstDay() || data.receiveDate < data.deadline)
      throw new AppError(
        "마감일은 오늘 이후, 수령일은 마감일 이후로 설정해주세요.",
      );
    const [r] =
      await sql`INSERT INTO buy_requests(owner_id,data,demo) VALUES(${user.id},${sql.json(data)},${user.demo}) RETURNING id`;
    return { id: r.id };
  }
  if (path === "requests/close") {
    const [r] =
      await sql`UPDATE buy_requests SET closed_at=now() WHERE id=${id()} AND owner_id=${user.id} RETURNING id`;
    if (!r) throw new AppError("내 요청만 마감할 수 있습니다.", 403);
    return { ok: true };
  }
  if (path === "storage") {
    if (user.role !== "storage")
      throw new AppError("보관업체 회원만 등록할 수 있습니다.", 403);
    const data = storageSchema.parse(body);
    const [r] =
      await sql`INSERT INTO warehouses(owner_id,data) VALUES(${user.id},${sql.json(data)}) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data RETURNING id`;
    return { id: r.id };
  }
  if (path === "favorites") {
    return await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      const [l] =
        await tx`SELECT id FROM listings WHERE id=${id()} AND NOT hidden`;
      if (!l) throw new AppError("상품이 없습니다.", 404);
      const rows =
        await tx`DELETE FROM favorites WHERE user_id=${user.id} AND listing_id=${l.id} RETURNING listing_id`;
      if (!rows.length)
        await tx`INSERT INTO favorites(user_id,listing_id) VALUES(${user.id},${l.id})`;
      return { saved: !rows.length };
    });
  }
  if (path === "notifications/read") {
    if (body.id)
      await sql`UPDATE notifications SET read_at=now() WHERE id=${id()} AND user_id=${user.id}`;
    else
      await sql`UPDATE notifications SET read_at=now() WHERE user_id=${user.id} AND read_at IS NULL`;
    return { ok: true };
  }
  if (path === "reports") {
    const data = z
      .object({
        kind: z.enum(["listing", "request", "storage", "broker"]),
        id: uuid,
        reason: z
          .string()
          .trim()
          .min(5, "신고 사유를 5자 이상 입력해주세요.")
          .max(1000),
      })
      .parse(body);
    const [count] =
      await sql`SELECT count(*)::int AS n FROM reports WHERE user_id=${user.id} AND created_at>now()-interval '1 day'`;
    if (count.n >= 10)
      throw new AppError("하루 신고 한도를 초과했습니다.", 429);
    await sql`INSERT INTO reports(user_id,kind,target_id,reason) VALUES(${user.id},${data.kind},${data.id},${data.reason})`;
    return { ok: true };
  }
  if (path === "activity") {
    const kind = z.enum(["visit", "contact"]).parse(body.kind);
    const target = z.string().max(150).optional().parse(body.target);
    if (kind === "visit")
      await sql`INSERT INTO activity(user_id,kind) VALUES(${user.id},'visit') ON CONFLICT DO NOTHING`;
    else {
      const [count] =
        await sql`SELECT count(*)::int AS n FROM activity WHERE user_id=${user.id} AND kind='contact' AND created_at>now()-interval '1 minute'`;
      if (count.n < 30)
        await sql`INSERT INTO activity(user_id,kind,target) VALUES(${user.id},'contact',${target || null})`;
    }
    return { ok: true };
  }
  if (path.startsWith("admin/")) {
    requireAdmin(user);
    return await sql.begin(async (tx) => {
      if (path === "admin/member") {
        const d = z
          .object({
            id: uuid,
            approval: z.enum(["pending", "approved", "rejected"]).optional(),
            suspended: z.boolean().optional(),
            role: z.enum(["broker", "buyer", "storage"]).optional(),
          })
          .parse(body);
        const [old] = await tx<
          User[]
        >`SELECT * FROM members WHERE id=${d.id} FOR UPDATE`;
        if (!old) throw new AppError("회원을 찾을 수 없습니다.", 404);
        if (old.admin && d.suspended)
          throw new AppError("운영자 계정은 이 화면에서 정지할 수 없습니다.");
        const approval =
          d.role && d.role !== old.role
            ? d.role === "broker"
              ? "pending"
              : "approved"
            : d.approval || old.approval;
        await tx`UPDATE members SET approval=${approval},suspended=${d.suspended ?? old.suspended},role=${d.role || old.role} WHERE id=${d.id}`;
        if (d.suspended) await tx`DELETE FROM sessions WHERE user_id=${d.id}`;
        await tx`INSERT INTO notifications(user_id,title,body,href) VALUES(${d.id},'회원 상태 안내',${d.role ? "회원 역할이 변경되었습니다." : approval === "approved" ? "회원 확인이 완료되었습니다." : approval === "rejected" ? "회원 정보를 확인해주세요. 중매인 정보 수정 후 다시 검토받을 수 있습니다." : "회원 상태가 변경되었습니다."},'/me')`;
      } else if (path === "admin/content") {
        const d = z
          .object({
            id: uuid,
            kind: z.enum(["listing", "request", "storage"]),
            hidden: z.boolean(),
          })
          .parse(body);
        const table = {
          listing: "listings",
          request: "buy_requests",
          storage: "warehouses",
        }[d.kind];
        const rows =
          await tx`UPDATE ${tx(table)} SET hidden=${d.hidden} WHERE id=${d.id} RETURNING id`;
        if (!rows.length) throw new AppError("게시물을 찾을 수 없습니다.", 404);
        await tx`DELETE FROM daily_snapshots`;
      } else if (path === "admin/report") {
        const d = z
          .object({ id: uuid, resolution: z.string().trim().min(1).max(1000) })
          .parse(body);
        await tx`UPDATE reports SET status='resolved',handled_by=${user.id},resolution=${d.resolution} WHERE id=${d.id}`;
      } else if (path === "admin/taxonomy") {
        const d = z
          .object({
            kind: z.enum(["region", "species"]),
            name: z.string().trim().min(1).max(60),
            active: z.boolean().default(true),
          })
          .parse(body);
        await tx`INSERT INTO taxonomy(kind,name,active) VALUES(${d.kind},${d.name},${d.active}) ON CONFLICT(kind,name) DO UPDATE SET active=excluded.active`;
      } else if (path === "admin/official") {
        const d = z
          .object({
            sourceName: z.string().min(1).max(100),
            sourceUrl: z.url().refine((s) => s.startsWith("https://")),
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            region: z.string().min(1).max(60),
            species: z.string().min(1).max(30),
            state: z.string().min(1).max(30),
            grade: z.string().min(1).max(80),
            unit: z.string().min(1).max(20),
            priceMin: z.coerce.number().int().positive(),
            priceMax: z.coerce.number().int().positive(),
            verified: z.literal(true),
          })
          .parse(body);
        if (
          d.priceMax < d.priceMin ||
          d.day > kstDay() ||
          Number.isNaN(Date.parse(d.day)) ||
          new Date(d.day).toISOString().slice(0, 10) !== d.day
        )
          throw new AppError("가격 범위와 기준일을 확인해주세요.");
        await tx`INSERT INTO official_prices(source_name,source_url,basis_day,region,species,state,grade,unit,price_min,price_max,verified_by) VALUES(${d.sourceName},${d.sourceUrl},${d.day},${d.region},${d.species},${d.state},${d.grade},${d.unit},${d.priceMin},${d.priceMax},${user.id})`;
      } else throw new AppError("지원하지 않는 작업입니다.", 404);
      await tx`INSERT INTO audit_log(actor_id,action,target,detail) VALUES(${user.id},${path},${String(body.id || body.name || "official")},${tx.json(body as Record<string, string>)})`;
      return { ok: true };
    });
  }
  throw new AppError("요청한 기능을 찾을 수 없습니다.", 404);
}
export async function ownedListing(id: string, user: User) {
  const [row] = await db()<
    Listing[]
  >`SELECT * FROM listings WHERE id=${uuid.parse(id)} AND owner_id=${user.id}`;
  return row?.data as ListingData | undefined;
}
