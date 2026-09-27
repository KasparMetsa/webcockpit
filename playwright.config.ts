import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
