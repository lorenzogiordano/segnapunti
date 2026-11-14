import { defineConfig } from "vitest/config";

// The browser tests in apps/scorer/e2e run with Playwright, not here.
export default defineConfig({ test: { include: ["packages/**/test/**/*.test.ts"] } });
