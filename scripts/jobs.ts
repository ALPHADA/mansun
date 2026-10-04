import "dotenv/config";
import { runJobs } from "../src/server/jobs";
import { syncOfficialPrices } from "../src/server/official/sync";
import { db } from "../src/server/db";
await runJobs();
console.log("Daily summaries and snapshots updated.");
console.table(await syncOfficialPrices());
await db().end();
