import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const url = new URL(process.env.MANSUN_DATABASE_URL!);
if (!url.pathname.startsWith("/mansun_market"))
  throw new Error("Only marketplace databases may be backed up");
const destination = path.resolve(
  process.env.BACKUP_DIR || "data/backups",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(destination, { recursive: true, mode: 0o700 });
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
const dump = spawnSync(
  "pg_dump",
  [
    "-Fc",
    "-h",
    url.hostname,
    "-p",
    url.port || "5432",
    "-U",
    decodeURIComponent(url.username) || process.env.USER || "",
    "-d",
    url.pathname.slice(1),
    "-f",
    path.join(destination, "database.dump"),
  ],
  { env, encoding: "utf8" },
);
if (dump.status !== 0) throw new Error("Database backup failed");
const uploads = path.resolve(process.env.UPLOAD_DIR || "data/uploads");
await mkdir(uploads, { recursive: true, mode: 0o700 });
const archive = spawnSync("tar", [
  "-czf",
  path.join(destination, "uploads.tar.gz"),
  "-C",
  uploads,
  ".",
]);
if (archive.status !== 0) throw new Error("Upload backup failed");
const verify = spawnSync(
  "pg_restore",
  ["--list", path.join(destination, "database.dump")],
  { encoding: "utf8" },
);
if (verify.status !== 0) throw new Error("Backup verification failed");
await writeFile(
  path.join(destination, "RESTORE.txt"),
  "Restore database.dump into a separate mansun_market_restore database, then extract uploads.tar.gz into its private UPLOAD_DIR. Never restore over the legacy mansun database.\n",
);
console.log("Verified backup:", destination);
