import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const sql = postgres(url, { max: 1 });
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO mansun_app; CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  console.log("schema reset");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
