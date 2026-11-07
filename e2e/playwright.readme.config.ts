import path from 'node:path';
import { defineConfig } from '@playwright/test';
import screenshotConfig from './playwright.store-screenshots.config';

/** A small, offline capture set for the README; no store artwork or overlays. */
export default defineConfig({
  ...screenshotConfig,
  testDir: path.join(__dirname, 'readme-screenshots'),
  projects: [{ name: 'readme' }],
  use: {
    ...screenshotConfig.use,
    launchOptions: {
      ...screenshotConfig.use?.launchOptions,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run startFrontend:e2e',
        url: 'http://localhost:4242',
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
  outputDir: path.join(__dirname, '..', '.tmp', 'readme-screenshots'),
});
