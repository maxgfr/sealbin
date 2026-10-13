import { defineConfig, devices } from "@playwright/test";

/** `bun run test:e2e` builds first with SEALBIN_RELAYS=ws://127.0.0.1:4174 (the local relay below). */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173/sealbin/",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(process.env.CI
      ? [
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        ]
      : []),
  ],
  webServer: [
    {
      command: "bunx vite preview --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173/sealbin/",
      reuseExistingServer: false,
    },
    {
      command: "bun scripts/test-relay.ts",
      port: 4174,
      reuseExistingServer: false,
    },
  ],
});
