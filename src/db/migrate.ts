import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  // RLS 정책은 idempotent SQL로 별도 적용
  const rls = readFileSync(path.join(process.cwd(), "src/db/rls.sql"), "utf8");
  await sql.unsafe(rls);
  // 앱 롤 권한 재부여 (새 테이블 포함)
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mansun_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mansun_app;
  `);
  console.log("migrated + RLS applied");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
