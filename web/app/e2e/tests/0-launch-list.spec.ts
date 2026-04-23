import { test, expect } from '../fixtures/test';
import { coordinator, validator } from '../fixtures/keypairs';
import { loginAs, getJwt } from '../helpers/auth';
import { installWalletStub } from '../helpers/wallet-stub';

// K.2 — Launch list

test('K.2.1 empty launch list renders without error when authenticated', async ({ page }) => {
  await loginAs(page, coordinator());
  await expect(page.getByText(/chain launches/i)).toBeVisible();
  await expect(page.getByText(/no launches yet/i)).toBeVisible();
  // No error message.
  await expect(page.getByText(/fetch failed/i)).not.toBeVisible();
});

test('K.2.2 New Launch button visible for coordinator, absent for unauthenticated', async ({ page }) => {
  // Unauthenticated — no New Launch.
  await page.goto('/');
  await expect(page.getByRole('link', { name: /new launch/i })).not.toBeVisible();

  // After coordinator login — New Launch appears.
  // Inject the session directly (bypasses interchain-kit wallet UI) then reload.
  const jwt = await getJwt(coordinator(), 'cosmos');
  const address = coordinator().address('cosmos');
  await page.addInitScript(
    ({ token, addr }) => {
      sessionStorage.setItem('coord_auth_token', token);
      sessionStorage.setItem('coord_auth_address', addr);
      sessionStorage.setItem('coord_auth_chain', 'cosmoshub');
    },
    { token: jwt, addr: address },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /new launch/i }).first()).toBeVisible();
});

test('K.2.3 created launch appears in the list', async ({ page }) => {
  await installWalletStub(page, coordinator());
  await loginAs(page, coordinator());

  // Navigate to create.
  await page.getByRole('link', { name: /new launch/i }).first().click();
  await expect(page).toHaveURL(/\/launch\/new/);

  // Fill in required fields.
  await fillNewLaunchForm(page, { chainName: 'listtest', chainId: 'listtest-1' });
  await page.getByRole('button', { name: /create launch/i }).click();

  // Redirect to launch detail.
  await expect(page).toHaveURL(/\/launch\/[a-f0-9-]{36}/, { timeout: 10_000 });

  // Go back to list.
  await page.goto('/');
  await expect(page.getByText('listtest', { exact: true })).toBeVisible();
  await expect(page.getByText('listtest-1')).toBeVisible();
});

// ── Helper ─────────────────────────────────────────────────────────────────────

export async function fillNewLaunchForm(
  page: import('@playwright/test').Page,
  overrides: { chainName?: string; chainId?: string } = {},
) {
  const chainName = overrides.chainName ?? 'testchain';
  const chainId = overrides.chainId ?? 'testchain-1';
  const prefix = chainName.slice(0, 8);
  const denom = `u${chainName.slice(0, 6)}`;
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

  // Chain record — use placeholder selectors (Field uses Text not label).
  await page.getByPlaceholder('mychain-1', { exact: true }).fill(chainId);
  await page.getByPlaceholder('mychain', { exact: true }).fill(chainName);
  await page.getByPlaceholder('cosmos', { exact: true }).fill(prefix);
  await page.getByPlaceholder('uatom', { exact: true }).fill(denom);
  await page.getByPlaceholder('gaiad', { exact: true }).fill('testd');
  await page.getByPlaceholder('v17.0.0', { exact: true }).fill('v1.0.0');
  await page.getByPlaceholder('4', { exact: true }).fill('1');
  // Gentx deadline — first datetime-local input.
  await page.locator('input[type="datetime-local"]').first().fill(future);
  // Repo URL + commit (optional but fill for completeness).
  await page.getByPlaceholder(/github\.com/).fill('https://github.com/test/test');
  await page.getByPlaceholder('abc1234').fill('abc1234');
  // Lead moniker — first moniker placeholder.
  await page.getByPlaceholder('Moniker (optional)').first().fill('lead');
}
