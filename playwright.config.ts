import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1280, height: 900 } },
  reporter: [["list"]],
});
