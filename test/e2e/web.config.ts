import { defineConfig, devices } from '@playwright/test'

// End-to-end tests of the hosted production build against the test
// environment (pnpm testenv:up). Run `pnpm build` and `pnpm apps:build` first.
// All values are the test-only values of test-setup/ and .env.example.
// STUDIO_E2E_PORT=3100 runs them next to something else on port 3000; the
// test realm accepts both ports.
const port = process.env.STUDIO_E2E_PORT ?? '3000'
const baseURL = `http://localhost:${port}`

// CI runs the files in shards of about the same duration, each against its
// own test environment (STUDIO_E2E_SHARD). "other" runs every file that no
// shard names, so a new file always runs.
const shards: Record<string, RegExp> = {
  apps: /\/apps\.spec\.ts$/,
  models3d: /\/models3d\.spec\.ts$/,
  content: /\/(viewer|structure|files|edit)\.spec\.ts$/,
}
const shard = process.env.STUDIO_E2E_SHARD
if (shard !== undefined && shard !== 'other' && !(shard in shards)) {
  throw new Error(`STUDIO_E2E_SHARD must be one of ${[...Object.keys(shards), 'other'].join(', ')}.`)
}
const named = shard === undefined || shard === 'other' ? undefined : shards[shard]
const others = shard === 'other' ? Object.values(shards) : []

export default defineConfig({
  testDir: 'web',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/web' }]] : 'list',
  outputDir: '../../test-results/web',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, ...(named ? { testMatch: named } : {}), testIgnore: [/mobile\.spec/, ...others] },
    // Phone-sized layout (aas-viewer-port plan D10).
    ...(named ? [] : [{ name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ }]),
  ],
  webServer: {
    command: 'node .output/server/index.mjs',
    cwd: '../..',
    url: `${baseURL}/api/studio/v1/context`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      NITRO_PORT: port,
      STUDIO_PUBLIC_URL: baseURL,
      STUDIO_DATABASE_URL: 'postgres://studio:studio@localhost:15432/studio',
      STUDIO_DATA_KEY: 'dGVzdC1vbmx5LWRhdGEta2V5LWZvci1sb2NhbC1kZXY',
      STUDIO_OIDC_ISSUER: 'http://keycloak.localhost:18080/realms/basyx-studio',
      STUDIO_OIDC_CLIENT_ID: 'studio-web',
      STUDIO_OIDC_CLIENT_SECRET: 'studio-web-test-secret',
      STUDIO_OIDC_SCOPES: 'openid profile email',
      STUDIO_PRIVATE_NETWORK_TARGETS: 'allow',
      STUDIO_TESTENV_SERVICE_SECRET: 'studio-service-test-secret',
      // Apps (MVP-3): run `pnpm apps:build` first.
      STUDIO_APPS_URL: `http://apps.localhost:${port}`,
      STUDIO_APPS_ALLOW_UNSIGNED: 'true',
      // The static token of the work-orders example's mock service (connections.spec.ts, ADR 0047).
      STUDIO_E2E_WORK_ORDERS_TOKEN: 'e2e-work-orders-token',
    },
  },
})
