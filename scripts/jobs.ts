import "dotenv/config";
import { runJobs } from "../src/server/jobs";
import { db } from "../src/server/db";
await runJobs();
console.log("Daily summaries and snapshots updated.");
await db().end();
