import "dotenv/config";
import { db } from "../src/server/db";
import { syncOfficialPrices } from "../src/server/official/sync";
const args = process.argv.slice(2);
try {
  if (args.length > 3 || (args[2] && !["mof", "kamis"].includes(args[2])))
    throw new Error(
      "사용법: pnpm prices:sync [종료일 YYYY-MM-DD] [일수 1~31] [mof|kamis]",
    );
  const result = await syncOfficialPrices({
    end: args[0],
    days: args[1] ? Number(args[1]) : 3,
    provider: args[2] as "mof" | "kamis" | undefined,
    force: true,
  });
  console.table(result);
  if (result.some((r) => ["error", "unconfigured"].includes(r.status)))
    process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "수집 실패");
  process.exitCode = 1;
} finally {
  await db().end();
}
