import { defineConfig, devices } from '@playwright/test';

// Site-root smoke test of a production build (ADR 0022): the built
// directory served by a plain static file server (scripts/static-server.ts)
// with the production headers, no Vite and no /__fixtures.
//   WC_PROD_DIR   the directory to serve (default dist; publish uses its staging dir)
//   WC_PROD_PORT  the port (default 4180)
const port = Number(process.env.WC_PROD_PORT ?? 4180);
const dir = process.env.WC_PROD_DIR ?? 'dist';

export default defineConfig({
  testDir: 'tests/e2e-prod',
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `node scripts/static-server.ts ${JSON.stringify(dir)} --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
