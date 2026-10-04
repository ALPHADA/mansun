import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { runJobs } from "../src/server/jobs";
import { db } from "../src/server/db";
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => controller.abort());
while (!controller.signal.aborted) {
  try {
    await runJobs();
  } catch (e) {
    console.error(
      "Daily job failed:",
      e instanceof Error ? e.message : "unknown",
    );
  }
  try {
    await setTimeout(60000, undefined, { signal: controller.signal });
  } catch {
    break;
  }
}
await db().end();
