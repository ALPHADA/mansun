import { db } from "./db";
import {
  kstDay,
  groupMarket,
  matchesInterests,
  type Listing,
  type User,
  type BuyRequest,
} from "../lib/model";
export async function runJobs(now = new Date()) {
  const sql = db();
  const day = kstDay(now),
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: "Asia/Seoul",
      }).format(now),
    );
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(884311)`;
    const days =
      await tx`SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Seoul')::date::text AS day FROM listings WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date<${day}::date AND NOT EXISTS(SELECT 1 FROM daily_snapshots s WHERE s.day=(listings.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
    for (const d of days) {
      const items = await tx<
        Listing[]
      >`SELECT l.* FROM listings l JOIN members m ON m.id=l.owner_id WHERE (l.created_at AT TIME ZONE 'Asia/Seoul')::date=${d.day}::date AND NOT l.hidden AND NOT m.suspended`;
      await tx`INSERT INTO daily_snapshots(day,groups) VALUES(${d.day},${tx.json(groupMarket(items).map((g) => ({ ...g })))}) ON CONFLICT(day) DO NOTHING`;
    }
    const users = await tx<
      User[]
    >`SELECT * FROM members WHERE NOT suspended AND NOT demo AND (profile->>'notifications')::boolean=true AND (profile->>'digestHour')::int<=${hour}`;
    const items = await tx<
      Listing[]
    >`SELECT l.* FROM listings l JOIN members m ON m.id=l.owner_id WHERE l.created_at>${now.toISOString()}::timestamptz-interval '1 day' AND l.created_at<=${now.toISOString()} AND NOT l.hidden AND NOT l.demo AND l.closed_at IS NULL AND l.expires_at>${now.toISOString()} AND NOT m.suspended`;
    const requests = await tx<
      BuyRequest[]
    >`SELECT r.* FROM buy_requests r JOIN members m ON m.id=r.owner_id WHERE r.created_at>${now.toISOString()}::timestamptz-interval '1 day' AND r.created_at<=${now.toISOString()} AND NOT r.hidden AND NOT r.demo AND r.closed_at IS NULL AND r.data->>'deadline'>=${day} AND NOT m.suspended`;
    for (const u of users) {
      const matching = items.filter(
        (l) =>
          l.owner_id !== u.id &&
          matchesInterests(l.data.region, l.data.species, u.profile.interests),
      );
      const demand = requests.filter(
        (r) =>
          r.owner_id !== u.id &&
          matchesInterests(r.data.region, r.data.species, u.profile.interests),
      );
      if (!matching.length && !demand.length) continue;
      await tx`INSERT INTO notifications(user_id,title,body,href,dedupe) VALUES(${u.id},'오늘의 관심 소식',${`관심 조건에 맞는 새 물건 ${matching.length}건, 매입 요청 ${demand.length}건이 있습니다.`},'/',${u.id + ":digest:" + day}) ON CONFLICT(dedupe) DO NOTHING`;
    }
    await tx`DELETE FROM sessions WHERE expires_at<now()`;
    await tx`DELETE FROM oauth_attempts WHERE expires_at<now()`;
    await tx`DELETE FROM oauth_signups WHERE expires_at<now()`;
    await tx`DELETE FROM otp_challenges WHERE created_at<now()-interval '7 days'`;
  });
}
