import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.runtime.test.tsx"],
    restoreMocks: true,
    maxWorkers: process.env.VITEST_MAX_WORKERS ? Number(process.env.VITEST_MAX_WORKERS) : process.platform === "win32" ? 2 : undefined,
  },
});
