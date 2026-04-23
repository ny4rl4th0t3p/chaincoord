import React from 'react';
import { render, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/contexts/auth';

// Mock the entire @interchain-kit/core module to avoid loading the WalletConnect
// transitive chain (which pulls in ESM-only packages like uint8arrays that Jest
// cannot transform in a CJS environment).
jest.mock('@interchain-kit/core', () => ({
  CosmosWallet: class CosmosWallet {},
}));

// Mock @interchain-kit/react/store/stateful-wallet for the same reason.
jest.mock('@interchain-kit/react/store/stateful-wallet', () => ({
  StatefulWallet: class StatefulWallet {},
}));

// Use a plain object type for the wallet in tests — we only care that
// getWalletOfType returns something with signArbitrary.
type MockWallet = { getWalletOfType: jest.Mock };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal mock wallet that simulates Keplr/Leap signArbitrary. */
function makeMockWallet(signResult?: object): MockWallet {
  const cosmosWallet = {
    signArbitrary: jest.fn().mockResolvedValue(
      signResult ?? {
        pub_key: { type: 'tendermint/PubKeySecp256k1', value: 'A1B2C3pubkeybase64==' },
        signature: 'abc123signaturebase64==',
      },
    ),
  };
  return {
    getWalletOfType: jest.fn().mockReturnValue(cosmosWallet),
  };
}

/** Renders a component inside AuthProvider and returns a handle to the auth context. */
function TestConsumer({ onAuth }: { onAuth: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onAuth(auth);
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="operator-address">{auth.operatorAddress ?? ''}</span>
      <span data-testid="error">{auth.error ?? ''}</span>
    </div>
  );
}

function renderWithAuth(onAuth: (auth: ReturnType<typeof useAuth>) => void) {
  return render(
    <AuthProvider>
      <TestConsumer onAuth={onAuth} />
    </AuthProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const CHALLENGE = 'dGVzdC1jaGFsbGVuZ2U=';
const TOKEN = 'eyJhbGciOiJFZERTQSJ9.test.token';
const ADDRESS = 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu';
const CHAIN_ID = 'mychain-1';

function mockFetchSuccess() {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ challenge: CHALLENGE }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: TOKEN }),
    } as Response)
    // Fallback for GET /auth/session (is_coordinator), DELETE /auth/session, etc.
    .mockResolvedValue({
      ok: true,
      json: async () => ({ is_coordinator: false }),
    } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthProvider / useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('starts unauthenticated', () => {
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.token).toBeNull();
    expect(auth.operatorAddress).toBeNull();
  });

  it('login: sets isAuthenticated and operatorAddress on success', async () => {
    mockFetchSuccess();
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.operatorAddress).toBe(ADDRESS);
    expect(auth.token).toBe(TOKEN);
    expect(auth.error).toBeNull();
  });

  it('login: calls POST /auth/challenge with operator_address', async () => {
    mockFetchSuccess();
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });

    const [challengeCall] = (global.fetch as jest.Mock).mock.calls;
    expect(challengeCall[0]).toContain('/auth/challenge');
    const body = JSON.parse(challengeCall[1].body);
    expect(body.operator_address).toBe(ADDRESS);
  });

  it('login: calls POST /auth/verify with correct fields', async () => {
    mockFetchSuccess();
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });

    const [, verifyCall] = (global.fetch as jest.Mock).mock.calls;
    expect(verifyCall[0]).toContain('/auth/verify');
    const body = JSON.parse(verifyCall[1].body);
    expect(body.operator_address).toBe(ADDRESS);
    expect(body.challenge).toBe(CHALLENGE);
    expect(body.pubkey_b64).toBe('A1B2C3pubkeybase64==');
    expect(body.signature).toBe('abc123signaturebase64==');
    expect(body.nonce).toBeTruthy();
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('login: payload passed to signArbitrary has correct canonical JSON format', async () => {
    mockFetchSuccess();
    const cosmosWallet = {
      signArbitrary: jest.fn().mockResolvedValue({
        pub_key: { value: 'pubkey==' },
        signature: 'sig==',
      }),
    };
    const wallet = {
      getWalletOfType: jest.fn().mockReturnValue(cosmosWallet),
    };
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });

    const [, , payloadArg] = cosmosWallet.signArbitrary.mock.calls[0];
    const parsed = JSON.parse(payloadArg);
    // Must contain exactly these three keys in alphabetical order
    expect(Object.keys(parsed)).toEqual(['challenge', 'operator_address', 'timestamp']);
    expect(parsed.challenge).toBe(CHALLENGE);
    expect(parsed.operator_address).toBe(ADDRESS);
  });

  it('login: sets error on challenge fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ message: 'rate limited' }),
    } as Response);
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      try { await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS); } catch {}
    });

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.error).toBe('rate limited');
  });

  it('login: sets error on verify failure', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge: CHALLENGE }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'signature verification failed' }),
      } as Response);
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      try { await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS); } catch {}
    });

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.error).toBe('signature verification failed');
  });

  it('login: throws when no CosmosWallet found on the wallet', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ challenge: CHALLENGE }),
    } as Response);
    const wallet = { getWalletOfType: jest.fn().mockReturnValue(undefined) };
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      try { await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS); } catch {}
    });

    expect(auth.error).toContain('No Cosmos wallet found');
  });

  it('logout: clears token and operatorAddress', async () => {
    mockFetchSuccess();
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });
    expect(auth.isAuthenticated).toBe(true);

    await act(async () => {
      await auth.logout();
    });

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.token).toBeNull();
    expect(auth.operatorAddress).toBeNull();
  });

  it('logout: calls DELETE /auth/session with Bearer token', async () => {
    mockFetchSuccess();
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });
    await act(async () => {
      await auth.logout();
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const deleteCall = calls.find((c: unknown[]) => (c[1] as Record<string, unknown>)?.method === 'DELETE');
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[0]).toContain('/auth/session');
    expect(deleteCall[1].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('revokeAllSessions: calls DELETE /auth/sessions/all and clears auth state', async () => {
    mockFetchSuccess();
    const wallet = makeMockWallet();
    let auth!: ReturnType<typeof useAuth>;
    renderWithAuth((a) => { auth = a; });

    await act(async () => {
      await auth.login(wallet as any, CHAIN_ID, 'mychain', ADDRESS);
    });
    expect(auth.isAuthenticated).toBe(true);

    await act(async () => {
      await auth.revokeAllSessions();
    });

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.token).toBeNull();
    expect(auth.operatorAddress).toBeNull();

    const calls = (global.fetch as jest.Mock).mock.calls;
    const revokeCall = calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>)?.method === 'DELETE' &&
        (c[0] as string).includes('/auth/sessions/all'),
    );
    expect(revokeCall).toBeTruthy();
    expect(revokeCall[1].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});