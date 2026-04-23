import { type Page, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { type TestKeypair } from '../fixtures/keypairs';
import { COORDD_PORT } from '../setup/global-setup';

// Per-worker JWT cache keyed by operator address.
// Uses a TTL (4 min) instead of live validation to avoid extra rate-limit-able calls.
// Call invalidateJwt() after any test that explicitly revokes sessions.
const _jwtCache = new Map<string, { token: string; obtainedAt: number }>();
const JWT_TTL_MS = 4 * 60 * 1000;

/**
 * Signs in by:
 *   1. Getting a JWT from the coordd API directly (no browser UI, fully reliable)
 *   2. Registering an addInitScript so sessionStorage is written BEFORE React mounts on
 *      every page load — prevents interchain-kit from auto-connecting in an unauthenticated
 *      state and potentially overwriting the correct auth
 *   3. Navigating to the target page (addInitScript fires, React mounts with correct auth)
 *   4. Reloading to guarantee a second clean React mount after addInitScript fires — this
 *      eliminates any race between interchain-kit initialisation and AuthProvider reading
 *      sessionStorage that can occur on the very first navigation to the page
 *   5. Waiting for "Sign Out" to confirm auth loaded
 *
 * This bypasses the interchain-kit wallet UI flow, which is unreliable in headless
 * tests due to npm package duplication breaking instanceof checks.
 */
export async function loginAs(
  page: Page,
  keypair: TestKeypair,
  options: { navigateTo?: string; bech32Prefix?: string; chainName?: string } = {},
): Promise<void> {
  const prefix = options.bech32Prefix ?? 'cosmos';
  const chain = options.chainName ?? 'cosmoshub';
  const jwt = await getJwt(keypair, prefix);
  const address = keypair.address(prefix);
  const target = options.navigateTo ?? '/';

  // Step 1: register addInitScript BEFORE any navigation so it fires on every page load,
  // including the navigations below. This prevents interchain-kit from auto-connecting in an
  // unauthenticated state during the first load, which could pollute React's auth state.
  await page.addInitScript(
    ({ token, addr, chainName }) => {
      sessionStorage.setItem('coord_auth_token', token);
      sessionStorage.setItem('coord_auth_address', addr);
      sessionStorage.setItem('coord_auth_chain', chainName);
    },
    { token: jwt, addr: address, chainName: chain },
  );

  // Step 2: navigate to the target page. addInitScript fires → sessionStorage is written
  // before React mounts → auth state is correct on first mount.
  await page.goto(target);

  // Step 3: reload the page. This guarantees a fresh React mount where addInitScript fires
  // before any JavaScript runs, eliminating any race between interchain-kit initialisation
  // and AuthProvider reading sessionStorage. Without this reload, interchain-kit sometimes
  // auto-connects and writes a different address into React's auth context during the initial
  // navigation.
  await page.reload();

  // AuthProvider restores from sessionStorage on mount → "Sign Out" appears.
  await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/** Obtains a JWT for the given keypair from the coordd backend directly.
 *  Returns a cached JWT if one is still valid; otherwise requests a fresh one. */
export async function getJwt(keypair: TestKeypair, prefix: string): Promise<string> {
  const base = `http://localhost:${COORDD_PORT}`;
  const address = keypair.address(prefix);

  const cached = _jwtCache.get(address);
  if (cached && Date.now() - cached.obtainedAt < JWT_TTL_MS) {
    return cached.token;
  }
  if (cached) _jwtCache.delete(address);

  const challengeRes = await fetch(`${base}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_address: address }),
  });
  if (!challengeRes.ok) throw new Error(`auth challenge failed: ${challengeRes.status}`);
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const payload = JSON.stringify({ challenge, operator_address: address, timestamp });
  const stdSig = await keypair.signArbitrary('cosmoshub-4', address, payload);

  const verifyRes = await fetch(`${base}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operator_address: address,
      pubkey_b64: stdSig.pub_key.value,
      challenge,
      nonce: randomUUID(),
      timestamp,
      signature: stdSig.signature,
    }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text().catch(() => '(unreadable)');
    throw new Error(`auth verify failed (${verifyRes.status}): ${body}`);
  }
  const { token } = (await verifyRes.json()) as { token: string };
  _jwtCache.set(address, { token, obtainedAt: Date.now() });
  return token;
}

/**
 * Call after any test that explicitly revokes sessions for a keypair.
 * Sleeps until the next second boundary so that the next getJwt() call
 * produces a token with iat strictly after the revocation fence — the server
 * rejects tokens whose iat equals the fence second.
 */
export async function invalidateJwt(keypair: TestKeypair, prefix: string): Promise<void> {
  _jwtCache.delete(keypair.address(prefix));
  const msUntilNextSecond = 1000 - (Date.now() % 1000);
  await new Promise(r => setTimeout(r, msUntilNextSecond));
}
