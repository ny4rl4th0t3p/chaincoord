import { type Page, expect } from '@playwright/test';
import { loginAs } from './auth';
import { installWalletStub } from './wallet-stub';
import { coordinator } from '../fixtures/keypairs';

/**
 * Logs in as coordinator, fills the new-launch form, submits, and waits for
 * redirect to the launch detail page.
 *
 * Returns the launch ID extracted from the URL.
 */
export async function createLaunch(
  page: Page,
  opts: {
    chainName?: string;
    chainId?: string;
    bech32Prefix?: string;
    denom?: string;
  } = {},
): Promise<string> {
  await installWalletStub(page, coordinator());
  await loginAs(page, coordinator());
  await page.getByRole('link', { name: /new launch/i }).first().click();
  await expect(page).toHaveURL(/\/launch\/new/);

  const chainName = opts.chainName ?? `chain${Date.now()}`;
  const chainId = opts.chainId ?? `${chainName}-1`;
  const prefix = opts.bech32Prefix ?? chainName.slice(0, 8);
  const denom = opts.denom ?? `u${chainName.slice(0, 6)}`;
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

  await page.getByPlaceholder('mychain-1', { exact: true }).fill(chainId);
  await page.getByPlaceholder('mychain', { exact: true }).fill(chainName);
  await page.getByPlaceholder('cosmos', { exact: true }).fill(prefix);
  await page.getByPlaceholder('uatom', { exact: true }).fill(denom);
  await page.getByPlaceholder('gaiad', { exact: true }).fill('testd');
  await page.getByPlaceholder('v17.0.0', { exact: true }).fill('v1.0.0');
  await page.getByPlaceholder('4', { exact: true }).fill('1');
  await page.locator('input[type="datetime-local"]').first().fill(future);
  await page.getByPlaceholder('Moniker (optional)').first().fill('lead');

  await page.getByRole('button', { name: /create launch/i }).click();

  await expect(page).toHaveURL(/\/launch\/[a-f0-9-]{36}/, { timeout: 15_000 });
  const url = page.url();
  return url.split('/launch/')[1];
}
