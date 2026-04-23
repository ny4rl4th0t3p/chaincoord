import { test, expect } from '../fixtures/test';
import { createLaunch } from '../helpers/launch';

// K.4 — Coordinator panel (single-actor)
// Each test creates a fresh launch to keep state independent.

test('K.4.1 open application window → status changes to OPEN', async ({ page }) => {
  await createLaunch(page, { chainName: 'k41chain', chainId: 'k41-1' });

  await page.getByRole('button', { name: /open application window/i }).click();

  // Status badge updates to OPEN.
  await expect(page.getByText(/\bopen\b/i).first()).toBeVisible({ timeout: 10_000 });
});

test('K.4.2 submit genesis reference → saved confirmation and SHA row visible', async ({ page }) => {
  await createLaunch(page, { chainName: 'k42chain', chainId: 'k42-1' });

  // Fill genesis reference fields.
  await page.getByPlaceholder('https://files.example.com/genesis.json').fill('https://example.com/genesis.json');
  await page.getByPlaceholder('64-character hex digest').fill('a'.repeat(64));
  await page.getByRole('button', { name: /submit genesis reference/i }).click();

  await expect(page.getByText(/genesis reference saved/i)).toBeVisible({ timeout: 10_000 });
  // Initial genesis SHA row appears in Chain Details card.
  await expect(page.getByText(/initial genesis sha/i)).toBeVisible();
});

test('K.4.3 set monitor RPC → saved confirmation', async ({ page }) => {
  await createLaunch(page, { chainName: 'k43chain', chainId: 'k43-1' });

  await page.getByPlaceholder('https://rpc.mychain.example.com').fill('https://rpc.k43.example.com');
  await page.getByRole('button', { name: /set monitor rpc/i }).click();

  await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 10_000 });
});

test('K.4.4 replace committee (DRAFT) → committee card updates', async ({ page }) => {
  await createLaunch(page, { chainName: 'k44chain', chainId: 'k44-1' });

  // Committee section is only visible in DRAFT — "Edit Committee" expands it.
  await page.getByRole('button', { name: /edit committee/i }).click();

  // Change threshold (currently 1/1 → keep 1/1 but just re-submit to confirm the flow works).
  // The threshold field has placeholder "1".
  // We can't easily distinguish it from min-validators on the create form, but
  // here we are on the detail page so only coordinator panel inputs are visible.
  const thresholdInput = page.getByPlaceholder('1').first();
  await thresholdInput.clear();
  await thresholdInput.fill('1');

  await page.getByRole('button', { name: /update committee/i }).click();

  await expect(page.getByText(/committee updated/i)).toBeVisible({ timeout: 10_000 });
});

test('K.4.5 cancel launch → two-step confirm → status CANCELED', async ({ page }) => {
  await createLaunch(page, { chainName: 'k45chain', chainId: 'k45-1' });

  await page.getByRole('button', { name: /^cancel launch$/i }).click();
  await expect(page.getByText(/are you sure/i)).toBeVisible();

  await page.getByRole('button', { name: /confirm cancel/i }).click();

  await expect(page.getByText('CANCELED', { exact: true })).toBeVisible({ timeout: 10_000 });
  // Cancel button is gone after terminal status.
  await expect(page.getByRole('button', { name: /^cancel launch$/i })).not.toBeVisible();
});
