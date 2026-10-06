import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { claimJob, processJob, seedJobs } from "../src/server/marine/worker";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function lane(name: "auction" | "weather") {
  while (!stopping) {
    try {
      const job = await claimJob(name);
      if (job) await processJob(job);
      else await setTimeout(5000);
    } catch {
      console.error("Marine worker database operation failed");
      await setTimeout(5000);
    }
    await setTimeout(250);
  }
}
await seedJobs();
await Promise.all([
  lane("auction"),
  lane("weather"),
  (async () => {
    while (!stopping) {
      await setTimeout(30000);
      try {
        await seedJobs();
      } catch {
        console.error("Marine scheduler failed");
      }
    }
  })(),
]);
process.exit(0);
