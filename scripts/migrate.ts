import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { defaultSpecies, provinces, speciesName } from "../src/lib/model";
const sql = db();
await sql.unsafe(
  await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
);
for (const [kind, names] of [
  ["region", provinces],
  ["species", defaultSpecies],
] as const)
  for (const name of names)
    await sql`INSERT INTO taxonomy(kind,name) VALUES(${kind},${name}) ON CONFLICT DO NOTHING`;
// 어종을 목록에서 고르기 전에 자유 입력으로 저장된 값을 목록 기반으로 옮긴다. 다시 실행해도 결과가 같다.
const tidy = (s: unknown) =>
  String(s)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .replace(/[.,·\s]+$/, "");
await sql.begin(async (sql) => {
  const legacy = new Set<string>();
  for (const w of await sql`SELECT id,data FROM warehouses`) {
    const before = w.data.species;
    const species = [
      ...new Set(
        (Array.isArray(before) ? before : String(before ?? "").split(/[,·/]/))
          .map(tidy)
          .filter(Boolean),
      ),
    ];
    species.forEach((s) => legacy.add(s));
    if (JSON.stringify(species) !== JSON.stringify(before))
      await sql`UPDATE warehouses SET data=${sql.json({ ...w.data, species })} WHERE id=${w.id}`;
  }
  for (const m of await sql`SELECT id,profile FROM members WHERE jsonb_array_length(coalesce(profile->'specialties','[]'))>0`) {
    const before: string[] = m.profile.specialties;
    const specialties = [...new Set(before.map(tidy).filter(Boolean))];
    specialties.forEach((s) => legacy.add(s));
    if (JSON.stringify(specialties) !== JSON.stringify(before))
      await sql`UPDATE members SET profile=${sql.json({ ...m.profile, specialties })} WHERE id=${m.id}`;
  }
  for (const r of await sql`SELECT data->>'species' AS name FROM listings UNION SELECT data->>'species' FROM buy_requests`)
    if (r.name) legacy.add(r.name);
  // 새 이름 규칙에 맞지 않는 옛 값은 숨긴 상태로 넣어 공개 목록에 나오지 않게 하고, 운영자가 확인하도록 알린다.
  for (const name of legacy) {
    const active = speciesName.safeParse(name).data === name;
    const added =
      await sql`INSERT INTO taxonomy(kind,name,active) VALUES('species',${name},${active}) ON CONFLICT DO NOTHING RETURNING name`;
    if (added.length && !active)
      console.warn(`숨긴 상태로 추가한 기존 어종 값: ${name}`);
  }
});
console.log("Independent marketplace schema ready.");
await sql.end();
