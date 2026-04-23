import { type Page } from '@playwright/test';
import { type TestKeypair } from '../fixtures/keypairs';

/**
 * Injects a window.keplr / window.leap stub into the page that auto-signs
 * without any extension popup. Signing happens in Node.js (via exposeFunction)
 * using the provided TestKeypair, so real secp256k1 signatures are produced and
 * the backend verifies them normally.
 *
 * Must be called before page.goto() so the script is present before React mounts.
 */
export async function installWalletStub(page: Page, keypair: TestKeypair): Promise<void> {
  // Bridge Node.js signing into the browser context.
  await page.exposeFunction('__pwSign', keypair.signArbitrary.bind(keypair));
  await page.exposeFunction('__pwAddress', () => keypair.address('cosmos'));
  await page.exposeFunction('__pwPubKey', () => keypair.pubKeyB64);

  // The script runs in the browser before React mounts.
  await page.addInitScript(() => {
    const keplr = {
      enable: async (_chainId: string) => {},
      getKey: async (_chainId: string) => {
        const address = await (window as any).__pwAddress();
        const pubKey = await (window as any).__pwPubKey();
        return { bech32Address: address, pubKey, name: 'test', algo: 'secp256k1', isNanoLedger: false };
      },
      signArbitrary: async (chainId: string, signer: string, data: string) => {
        return (window as any).__pwSign(chainId, signer, data);
      },
      experimentalSuggestChain: async (_chainInfo: unknown) => {},
      version: '0.12.0',
      // walletIdentifyKey used by @interchain-kit/keplr-extension to detect installation.
      ethereum: { isKeplr: true },
    };

    (window as any).keplr = keplr;
    // Leap uses the same interface.
    (window as any).leap = { ...keplr, ethereum: { isLeap: true } };
  });
}

/**
 * Like installWalletStub but uses a per-launch bech32 prefix for the address
 * (used for the validator flow where the validator address is on the launch chain).
 */
export async function installValidatorWalletStub(
  page: Page,
  keypair: TestKeypair,
  bech32Prefix: string,
): Promise<void> {
  await page.exposeFunction('__pwSign', keypair.signArbitrary.bind(keypair));
  await page.exposeFunction('__pwAddress', () => keypair.address(bech32Prefix));
  await page.exposeFunction('__pwPubKey', () => keypair.pubKeyB64);

  await page.addInitScript(() => {
    const keplr = {
      enable: async (_chainId: string) => {},
      getKey: async (_chainId: string) => {
        const address = await (window as any).__pwAddress();
        const pubKey = await (window as any).__pwPubKey();
        return { bech32Address: address, pubKey, name: 'test', algo: 'secp256k1', isNanoLedger: false };
      },
      signArbitrary: async (chainId: string, signer: string, data: string) => {
        return (window as any).__pwSign(chainId, signer, data);
      },
      experimentalSuggestChain: async (_chainInfo: unknown) => {},
      version: '0.12.0',
      ethereum: { isKeplr: true },
    };

    (window as any).keplr = keplr;
    (window as any).leap = { ...keplr, ethereum: { isLeap: true } };
  });
}
