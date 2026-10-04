import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: { alias: { "@": path.resolve("src") } },
});
