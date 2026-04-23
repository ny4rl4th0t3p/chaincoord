import { useState, useCallback } from 'react';
import { useWalletManager } from '@interchain-kit/react';
import { buildChainSuggestion, ChainHint } from '@/utils/chainSuggestion';

export interface UseAddChainToWalletResult {
  addChain: () => Promise<void>;
  isPending: boolean;
  isRegistered: boolean;
  /** The chain hint returned by the backend — available once isRegistered is true. */
  hint: ChainHint | null;
  error: Error | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Fetches the chain-hint for a launch (unauthenticated) and registers the chain
 * with the WalletManager + all connected wallet extensions via experimentalSuggestChain.
 *
 * `isRegistered` becomes true once addChains() completes (chain is known to interchain-kit).
 * Any useChain(chainName) call must be gated on isRegistered to avoid ChainNameNotExist errors.
 * Use `hint.chain_name` as the chainName argument to useChain.
 */
export function useAddChainToWallet(launchId: string): UseAddChainToWalletResult {
  const store = useWalletManager();
  const [isPending, setIsPending] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [hint, setHint] = useState<ChainHint | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const addChain = useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/launch/${launchId}/chain-hint`);
      if (!res.ok) {
        throw new Error(`chain-hint fetch failed: ${res.status}`);
      }
      const fetchedHint: ChainHint = await res.json();
      const { chain, assetList } = buildChainSuggestion(fetchedHint);

      // Register chain in interchain-kit's internal store.
      await store.addChains([chain], [assetList]);

      // addChains does NOT call experimentalSuggestChain on the live wallet extension.
      // We must do it explicitly so Keplr/Leap actually know about the chain.
      // Iterate all wallets and ignore errors for wallets that aren't installed.
      await Promise.allSettled(
        (store.wallets as Array<{ addSuggestChain: (id: string) => Promise<void> }>)
          .map((w) => w.addSuggestChain(fetchedHint.chain_id))
      );

      setHint(fetchedHint);
      setIsRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsPending(false);
    }
  }, [launchId, store]);

  return { addChain, isPending, isRegistered, hint, error };
}