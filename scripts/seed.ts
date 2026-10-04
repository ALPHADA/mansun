import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db } from "../src/server/db";
import { profileSchema, listingSchema, endOfDay } from "../src/lib/model";
if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_DEMO_SEED !== "true"
)
  throw new Error(
    "Demo seed requires ALLOW_DEMO_SEED=true and non-production mode.",
  );
const sql = db();
const [real] = await sql`SELECT count(*)::int AS n FROM members WHERE NOT demo`;
if (real.n)
  throw new Error(
    "Refusing to mix demo fixtures into a database with real members.",
  );
const dir = path.resolve(process.env.UPLOAD_DIR || "data/uploads");
await mkdir(dir, { recursive: true, mode: 0o700 });
for (let i = 0; i < 4; i++) {
  const region = ["충남 태안", "부산", "전남 여수", "강원 속초"][i],
    business = [
      "시연 신진수산",
      "시연 부산수산",
      "시연 여수수산",
      "시연 동해수산",
    ][i];
  const profile = profileSchema.parse({
    name: "시연 중매인",
    business,
    industry: "중매인",
    region,
    market: ["신진도 위판장", "부산 위판장", "여수 위판장", "속초 위판장"][i],
    license: "시연",
    contact: "0109000000" + i,
    bio: "화면 검증용 시연 프로필입니다. 실제 판매자나 실제 시세가 아닙니다.",
    specialties: ["선어"],
    procurement: true,
  });
  await sql`UPDATE members SET phone=${profile.contact} WHERE demo AND phone=${"0100000000" + i}`;
  const [u] =
    await sql`INSERT INTO members(phone,role,profile,approval,admin,demo) VALUES(${profile.contact},'broker',${sql.json(profile)},'approved',${i === 0},true) ON CONFLICT(phone) DO UPDATE SET profile=excluded.profile RETURNING id`;
  const [existing] =
    await sql`SELECT id FROM listings WHERE owner_id=${u.id} AND expires_at>now()`;
  if (existing) continue;
  const image = randomUUID() + ".webp";
  await sharp(i === 1 ? "public/demo/salmon.jpg" : "public/demo/market.jpg")
    .resize(1000, 800, { fit: "cover" })
    .webp({ quality: 80 })
    .toFile(path.join(dir, image));
  await sql`INSERT INTO assets(id,owner_id) VALUES(${image},${u.id})`;
  const data = listingSchema.parse({
    species: i === 1 ? "연어" : "선어 모둠",
    state: "선어",
    grade: [
      "모둠 · 규격 확인",
      "원물 · 규격 확인",
      "모둠 · 규격 확인",
      "모둠 · 규격 확인",
    ][i],
    region,
    market: profile.market,
    unit: i === 1 ? "kg" : "상자",
    priceMin: [35000, 18000, 28000, 42000][i],
    priceMax: [40000, 23000, 32000, 45000][i],
    quantity: [20, 100, 30, 15][i],
    minimum: 1,
    weightKg: null,
    pickup: "시연용 위치 · 실제 인수 불가",
    pickupHours: "07:00–14:00",
    photos: ["/media/" + image],
    note: "실제 판매 상품이 아닌 화면 시연용 데이터입니다. 사진은 Pexels 참고 이미지이며 금액·물량은 가상입니다.",
    confirmed: true,
  });
  const [l] =
    await sql`INSERT INTO listings(owner_id,data,expires_at,demo) VALUES(${u.id},${sql.json(data)},${endOfDay()},true) RETURNING id`;
  await sql`INSERT INTO price_history(listing_id,data,actor_id) VALUES(${l.id},${sql.json(data)},${u.id})`;
}
console.log(
  "Four clearly marked local demo listings created. Never run against production.",
);
await sql.end();
