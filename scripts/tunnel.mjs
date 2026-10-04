import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
const destination = process.env.PUBLIC_ORIGIN_FILE;
if (!destination) throw new Error("PUBLIC_ORIGIN_FILE is required");
const child = spawn(
  process.env.CLOUDFLARED_BIN || "cloudflared",
  [
    "tunnel",
    "--config",
    path.resolve("scripts/quick-tunnel.yml"),
    "--url",
    "http://127.0.0.1:3005",
    "--no-autoupdate",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let buffered = "";
function log(data) {
  const line = data.toString();
  process.stdout.write(line);
  buffered = (buffered + line).slice(-5000);
  const match = buffered.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match) {
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination + ".tmp", match[0], { mode: 0o600 });
    renameSync(destination + ".tmp", destination);
  }
}
child.stdout.on("data", log);
child.stderr.on("data", log);
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code || 1));
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
