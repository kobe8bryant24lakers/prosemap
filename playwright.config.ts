import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Multi-step scenarios can take a minute on shared Linux WebKit runners.
  // Give CI time to finish the sequence without relaxing individual assertions.
  timeout: process.env.CI ? 120_000 : 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'outputs/playwright-report', open: 'never' }], ['json', { outputFile: 'outputs/playwright-results.json' }]],
  outputDir: 'outputs/playwright-artifacts',
  use: {
    baseURL: 'http://127.0.0.1:1421',
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: 'npm run dev -- --port 1421 --force',
    env: { PROSEMAP_VITE_CACHE_DIR: 'node_modules/.vite-playwright' },
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
