import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { defaultSpecies, provinces } from "../src/lib/model";
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
console.log("Independent marketplace schema ready.");
await sql.end();
