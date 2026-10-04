import { readFileSync } from "node:fs";
export function publicOrigin() {
  if (process.env.PUBLIC_ORIGIN_FILE) {
    try {
      const value = readFileSync(
        /* turbopackIgnore: true */ process.env.PUBLIC_ORIGIN_FILE,
        "utf8",
      ).trim();
      if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(value))
        return value;
    } catch {
      /* A tunnel may still be starting. */
    }
  }
  return process.env.APP_ORIGIN || "http://localhost:3005";
}
export function smsReady() {
  return !!(
    process.env.SOLAPI_API_KEY &&
    process.env.SOLAPI_API_SECRET &&
    process.env.SOLAPI_FROM
  );
}
