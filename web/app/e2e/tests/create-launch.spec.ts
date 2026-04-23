import { test, expect } from '../fixtures/test';
import { coordinator } from '../fixtures/keypairs';
import { loginAs } from '../helpers/auth';
import { createLaunch } from '../helpers/launch';

// K.3 — Create launch

test('K.3.1 /launch/new redirects to index when not authenticated', async ({ page }) => {
  await page.goto('/launch/new');
  await expect(page).toHaveURL('/', { timeout: 5_000 });
});

test('K.3.2 submit without chain_id shows error', async ({ page }) => {
  await loginAs(page, coordinator());
  await page.getByRole('link', { name: /new launch/i }).first().click();

  // Skip chain_id, fill only a few fields, then submit.
  await page.getByPlaceholder('mychain', { exact: true }).fill('incomplete');
  await page.getByRole('button', { name: /create launch/i }).click();

  await expect(page.getByText(/chain_id is required/i)).toBeVisible();
  // Still on the create page.
  await expect(page).toHaveURL(/\/launch\/new/);
});

test('K.3.3 valid submit redirects to launch detail with correct metadata', async ({ page }) => {
  const launchId = await createLaunch(page, {
    chainName: 'k3test',
    chainId: 'k3test-1',
    bech32Prefix: 'k3test',
    denom: 'uk3test',
  });

  expect(launchId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByText('k3test', { exact: true })).toBeVisible();
  await expect(page.getByText('k3test-1')).toBeVisible();
  // Status starts as DRAFT.
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
});
