import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@interchain-ui/react';
import { useChain } from '@interchain-kit/react';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/contexts';
import { COORDINATOR_CHAIN_NAMES, CoordinatorChainName } from '@/config';

const CHAIN_LABELS: Record<CoordinatorChainName, string> = {
  cosmoshub: 'Cosmos Hub',
  osmosis: 'Osmosis',
  juno: 'Juno',
};

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

export function GlobalSignIn() {
  const { isAuthenticated, operatorAddress, isPending, error, login, logout } = useAuth();
  const [selectedChain, setSelectedChain] = useState<CoordinatorChainName>('cosmoshub');

  // useChain must be called unconditionally — all COORDINATOR_CHAIN_NAMES are pre-registered.
  const { address, connect, disconnect, wallet, chain } = useChain(selectedChain);

  // Auto-trigger JWT login when the wallet connects after an explicit "Connect Wallet" click.
  const connectInitiated = useRef(false);
  useEffect(() => {
    if (!connectInitiated.current || !address || !wallet || isAuthenticated || isPending) return;
    connectInitiated.current = false;
    login(wallet, chain.chainId as string, selectedChain, address).catch(() => {});
  }, [address, wallet, isAuthenticated, isPending, chain, selectedChain, login]);

  const handleConnect = () => {
    connectInitiated.current = true;
    connect();
  };

  // ── Authenticated ────────────────────────────────────────────────────────────

  if (isAuthenticated && operatorAddress) {
    return (
      <Box display="flex" alignItems="center" gap="8px">
        <Text fontSize="$sm" color="$textSecondary" fontFamily="monospace">
          {truncateAddress(operatorAddress)}
        </Text>
        <Button variant="outline" size="sm" onClick={logout}>
          Sign Out
        </Button>
      </Box>
    );
  }

  // ── Wallet connected, awaiting sign-in ───────────────────────────────────────

  if (address) {
    return (
      <Box display="flex" alignItems="center" gap="8px">
        <Text fontSize="$sm" color="$textSecondary" fontFamily="monospace">
          {truncateAddress(address)}
        </Text>
        <Button
          variant="primary"
          size="sm"
          onClick={() => login(wallet!, chain.chainId as string, selectedChain, address)}
          isLoading={isPending}
          disabled={isPending}
        >
          {isPending ? 'Signing…' : 'Sign In'}
        </Button>
        <Button variant="text" size="sm" onClick={disconnect}>
          ✕
        </Button>
        {error && (
          <Text fontSize="$xs" color="$textDanger">
            {error}
          </Text>
        )}
      </Box>
    );
  }

  // ── Not connected ────────────────────────────────────────────────────────────

  return (
    <Box display="flex" alignItems="center" gap="8px">
      <Box
        as="select"
        fontSize="$sm"
        color="$text"
        backgroundColor="$background"
        borderWidth="1px"
        borderStyle="$solid"
        borderColor="$blackAlpha200"
        borderRadius="4px"
        px="8px"
        height="32px"
        cursor="pointer"
        attributes={{
          value: selectedChain,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            setSelectedChain(e.target.value as CoordinatorChainName),
        }}
      >
        {COORDINATOR_CHAIN_NAMES.map((name) => (
          <option key={name} value={name}>
            {CHAIN_LABELS[name]}
          </option>
        ))}
      </Box>
      <Button variant="primary" size="sm" onClick={handleConnect}>
        Connect Wallet
      </Button>
    </Box>
  );
}