import { defineConfig, devices } from "@playwright/test";

const rawPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "4173", 10);
const port = Number.isFinite(rawPort) && rawPort > 1024 && rawPort < 65535 ? rawPort : 4173;
const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: baseUrl,
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    trace: "on-first-retry",
    video: "retain-on-failure",
    viewport: { width: 960, height: 640 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host ${host} --port ${port}`,
    url: baseUrl,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
