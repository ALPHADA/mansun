import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,   // 통합 테스트는 같은 DB를 공유 → 파일 단위 직렬
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
      "next/headers": path.resolve(__dirname, "tests/mocks/next-headers.ts"),
      "next/navigation": path.resolve(__dirname, "tests/mocks/next-navigation.ts"),
      "next/cache": path.resolve(__dirname, "tests/mocks/next-cache.ts"),
    },
  },
});
