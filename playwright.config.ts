import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 40000,
  use: { baseURL: "http://localhost:3006", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3006",
    url: "http://localhost:3006/api/health",
    reuseExistingServer: false,
    env: {
      MANSUN_DATABASE_URL: "postgres://localhost:5432/mansun_market_e2e_test",
      APP_ORIGIN: "http://localhost:3006",
      AUTH_SECRET: "isolated-e2e-secret-with-at-least-32-bytes",
      DEV_SMS_PREVIEW: "true",
      UPLOAD_DIR: "./data/e2e-uploads",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
