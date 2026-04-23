import { test, expect } from '../fixtures/test';
import { createLaunch } from '../helpers/launch';

// K.6 — Audit log

test('K.6.1 Load Audit Log button appears in launch detail', async ({ page }) => {
  await createLaunch(page, { chainName: 'k61chain', chainId: 'k61-1' });
  await expect(page.getByRole('button', { name: /load audit log/i })).toBeVisible();
});

test('K.6.2 audit entries appear after coordinator action', async ({ page }) => {
  await createLaunch(page, { chainName: 'k62chain', chainId: 'k62-1' });

  await page.getByPlaceholder('https://files.example.com/genesis.json').fill('https://example.com/genesis.json');
  await page.getByPlaceholder('64-character hex digest').fill('a'.repeat(64));
  await page.getByRole('button', { name: /submit genesis reference/i }).click();
  await expect(page.getByText(/genesis reference saved/i)).toBeVisible({ timeout: 10_000 });

  // Perform an action that produces an audit entry.
  await page.getByRole('button', { name: /open application window/i }).click();
  await expect(page.getByText(/WINDOW_OPEN/i).or(page.getByText(/\bopen\b/i)).first()).toBeVisible({ timeout: 10_000 });

  // Load the audit log.
  await page.getByRole('button', { name: /load audit log/i }).click();

  // At least one entry should appear.
  await expect(page.getByText(/LaunchCreated/i).first()).toBeVisible({ timeout: 10_000 });
});

test('K.6.3 expanding an entry shows payload JSON', async ({ page }) => {
  await createLaunch(page, { chainName: 'k63chain', chainId: 'k63-1' });

  await page.getByPlaceholder('https://files.example.com/genesis.json').fill('https://example.com/genesis.json');
  await page.getByPlaceholder('64-character hex digest').fill('a'.repeat(64));
  await page.getByRole('button', { name: /submit genesis reference/i }).click();
  await expect(page.getByText(/genesis reference saved/i)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /open application window/i }).click();
  await expect(page.getByText(/WINDOW_OPEN/i).or(page.getByText(/\bopen\b/i)).first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /load audit log/i }).click();

  // Click the first entry row to expand it.
  const firstEntry = page.getByText(/LaunchCreated/i).first();
  await firstEntry.waitFor({ state: 'visible', timeout: 10_000 });
  await firstEntry.click();

  // Payload JSON should appear (contains opening brace of JSON object).
  await expect(page.getByText(/\{/).first()).toBeVisible({ timeout: 5_000 });
});

test('K.6.4 server audit pubkey row present after loading audit log', async ({ page }) => {
  await createLaunch(page, { chainName: 'k64chain', chainId: 'k64-1' });
  await page.getByRole('button', { name: /load audit log/i }).click();
  // The pubkey row label.
  await expect(page.getByText(/server audit pubkey/i)).toBeVisible({ timeout: 10_000 });
});
