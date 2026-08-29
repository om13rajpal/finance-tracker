import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // This external volume generates AppleDouble sidecar files (e.g. "._foo.spec.ts")
  // for every real file — matched by Playwright's default test glob and crashing the
  // runner on their binary content. Same issue/fix as api/vitest.config.ts's `exclude`.
  testIgnore: "**/._*",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "./scripts/start-stack.sh",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
