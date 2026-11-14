import { defineConfig, devices } from "@playwright/test";

const tablet = { viewport: { width: 1080, height: 810 } };

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  use: { baseURL: "http://localhost:4173/segnapunti/" },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/segnapunti/",
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...tablet } },
    { name: "webkit", use: { ...devices["Desktop Safari"], ...tablet } },
  ],
});
