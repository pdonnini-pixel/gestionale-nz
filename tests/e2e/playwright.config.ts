import { defineConfig, devices } from '@playwright/test'

// Config isolata per la verifica pixel: gira contro il SITO DEPLOYATO
// (BASE_URL), non contro un dev server. Non dipende dal build dell'app.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'https://gestionale-nz.netlify.app',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
