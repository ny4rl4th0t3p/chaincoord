import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react';
import { CosmosWallet } from '@interchain-kit/core';
import { StatefulWallet } from '@interchain-kit/react/store/stateful-wallet';
import { buildAuthPayload, generateNonce, nowTimestamp } from '@/utils/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthState {
  token: string | null;
  operatorAddress: string | null;
  /** Chain-registry name of the chain used for the current session (e.g. 'cosmoshub'). */
  chainName: string | null;
  isAuthenticated: boolean;
  isCoordinator: boolean;
  isPending: boolean;
  error: string | null;
}

export interface AuthActions {
  /**
   * Full auth flow:
   *   1. POST /auth/challenge
   *   2. signArbitrary via the provided wallet
   *   3. POST /auth/verify → store JWT in memory
   *
   * @param wallet     StatefulWallet from useChain(chainName).wallet
   * @param chainId    The chain's on-chain ID string (e.g. "cosmoshub-4", "mychain-1")
   * @param chainName  The chain-registry name (e.g. "cosmoshub") — stored in context
   * @param address    The operator's bech32 address on that chain
   */
  login(wallet: StatefulWallet, chainId: string, chainName: string, address: string): Promise<void>;
  logout(): Promise<void>;
  /** Revokes all active sessions for the current operator, then logs out. */
  revokeAllSessions(): Promise<void>;
}

export type AuthContextValue = AuthState & AuthActions;

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [operatorAddress, setOperatorAddress] = useState<string | null>(null);
  const [chainName, setChainName] = useState<string | null>(null);
  const [isCoordinator, setIsCoordinator] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to the token for use in logout without stale closure issues.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  // Restore session from sessionStorage on mount (survives page refresh).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedToken = sessionStorage.getItem('coord_auth_token');
    const storedAddress = sessionStorage.getItem('coord_auth_address');
    const storedChain = sessionStorage.getItem('coord_auth_chain');
    if (!storedToken || !storedAddress) return;
    setToken(storedToken);
    setOperatorAddress(storedAddress);
    setChainName(storedChain);
    // Fetch coordinator status in the background.
    fetch(`${API_BASE}/auth/session`, { headers: { Authorization: `Bearer ${storedToken}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setIsCoordinator(data.is_coordinator === true); })
      .catch(() => {});
  }, []);

  const login = useCallback(
    async (wallet: StatefulWallet, chainId: string, chainName: string, address: string) => {
      setIsPending(true);
      setError(null);
      try {
        // G.2 — fetch challenge
        const challengeRes = await fetch(`${API_BASE}/auth/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operator_address: address }),
        });
        if (!challengeRes.ok) {
          const body = await challengeRes.json().catch(() => ({}));
          throw new Error(body.message ?? `challenge fetch failed: ${challengeRes.status}`);
        }
        const { challenge } = await challengeRes.json();

        // G.3 — build payload and sign
        const timestamp = nowTimestamp();
        const payload = buildAuthPayload(address, challenge, timestamp);

        // getWalletOfType uses instanceof which breaks when npm installs multiple copies of
        // @interchain-kit/core (each package can bundle its own private copy).
        // Wrap in try/catch so any thrown error (missing method or instanceof failure)
        // falls through to the window.keplr fallback.
        let cosmosWallet: any = null;
        try {
          cosmosWallet =
            wallet?.getWalletOfType?.(CosmosWallet) ??
            (wallet?.originalWallet as any)?.getWalletByChainType?.('cosmos') ??
            (typeof (wallet?.originalWallet as any)?.signArbitrary === 'function'
              ? (wallet.originalWallet as any)
              : null);
        } catch {
          cosmosWallet = null;
        }

        let stdSig: { pub_key: { value: string }; signature: string };
        if (cosmosWallet) {
          stdSig = await cosmosWallet.signArbitrary(chainId, address, payload);
        } else if (typeof (window as any).keplr?.signArbitrary === 'function') {
          stdSig = await (window as any).keplr.signArbitrary(chainId, address, payload);
        } else {
          throw new Error('No Cosmos wallet found — connect Keplr or Leap first');
        }
        // StdSignature.pub_key.value is the base64-encoded 33-byte compressed secp256k1 pubkey.
        const pubKeyB64 = stdSig.pub_key.value;
        const signature = stdSig.signature;

        // G.4 — verify and receive JWT
        const nonce = generateNonce();
        const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operator_address: address,
            pubkey_b64: pubKeyB64,
            challenge,
            nonce,
            timestamp,
            signature,
          }),
        });
        if (!verifyRes.ok) {
          const body = await verifyRes.json().catch(() => ({}));
          throw new Error(body.message ?? `verification failed: ${verifyRes.status}`);
        }
        const { token: jwt } = await verifyRes.json();

        // Fetch coordinator status immediately after obtaining the token.
        // Errors are non-fatal — isCoordinator stays false.
        let coordinator = false;
        try {
          const sessionRes = await fetch(`${API_BASE}/auth/session`, {
            headers: { Authorization: `Bearer ${jwt}` },
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            coordinator = sessionData.is_coordinator === true;
          }
        } catch {
          // ignore
        }

        setToken(jwt);
        setOperatorAddress(address);
        setChainName(chainName);
        setIsCoordinator(coordinator);
        sessionStorage.setItem('coord_auth_token', jwt);
        sessionStorage.setItem('coord_auth_address', address);
        sessionStorage.setItem('coord_auth_chain', chainName);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [],
  );

  const revokeAllSessions = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (currentToken) {
      await fetch(`${API_BASE}/auth/sessions/all`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    setToken(null);
    setOperatorAddress(null);
    setChainName(null);
    setIsCoordinator(false);
    setError(null);
    sessionStorage.removeItem('coord_auth_token');
    sessionStorage.removeItem('coord_auth_address');
    sessionStorage.removeItem('coord_auth_chain');
  }, []);

  const logout = useCallback(async () => {
    const currentToken = tokenRef.current;
    setToken(null);
    setOperatorAddress(null);
    setChainName(null);
    setIsCoordinator(false);
    setError(null);
    sessionStorage.removeItem('coord_auth_token');
    sessionStorage.removeItem('coord_auth_address');
    sessionStorage.removeItem('coord_auth_chain');

    if (currentToken) {
      // Best-effort — don't block on failure.
      fetch(`${API_BASE}/auth/session`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
  }, []);

  const value: AuthContextValue = {
    token,
    operatorAddress,
    chainName,
    isAuthenticated: token !== null,
    isCoordinator,
    isPending,
    error,
    login,
    logout,
    revokeAllSessions,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

/**
 * Returns auth state and a boolean indicating whether the user is authenticated.
 * Pages that require auth can gate their content on `isAuthenticated`.
 */
export function useRequireAuth(): AuthContextValue & { isAuthenticated: boolean } {
  return useAuth();
}