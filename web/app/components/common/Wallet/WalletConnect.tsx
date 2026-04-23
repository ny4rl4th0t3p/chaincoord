import { useState } from 'react';
import { useChain } from '@interchain-kit/react';

import { useChainStore } from '@/contexts';
import { Connected } from './Connected';
import { Connecting } from './Connecting';
import { SelectWallet } from './SelectWallet';

export const WalletConnect = () => {
  const { selectedChain } = useChainStore();
  const { wallet, address } = useChain(selectedChain);

  const [selectedWalletName, setSelectedWalletName] = useState<string | null>(null);

  // Already connected (including auto-reconnect on page load)
  if (wallet && address) {
    return (
      <Connected
        selectedWalletName={wallet.info.name}
        clearSelectedWallet={() => setSelectedWalletName(null)}
      />
    );
  }

  if (selectedWalletName) {
    return (
      <Connecting
        selectedWalletName={selectedWalletName}
        clearSelectedWallet={() => setSelectedWalletName(null)}
      />
    );
  }

  return <SelectWallet setSelectedWalletName={setSelectedWalletName} />;
};
