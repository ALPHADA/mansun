import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,            // 모든 스펙이 같은 dev DB 를 공유 → 직렬 실행
  fullyParallel: false,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1280, height: 900 } },
  reporter: [["list"]],
});
