import { Chain, AssetList } from '@chain-registry/v2-types';
import { chain as cosmoshubChain, assetList as cosmoshubAssets } from '@chain-registry/v2/mainnet/cosmoshub';
import { chain as osmosisChain, assetList as osmosisAssets } from '@chain-registry/v2/mainnet/osmosis';
import { chain as junoChain, assetList as junoAssets } from '@chain-registry/v2/mainnet/juno';

// Pre-registered chains available for coordinator / admin sign-in.
// These are already in every Keplr / Leap installation, so no experimentalSuggestChain
// is needed — useChain(name) works immediately for all entries in this list.
export const chains: Chain[] = [
  cosmoshubChain as unknown as Chain,
  osmosisChain as unknown as Chain,
  junoChain as unknown as Chain,
];

export const assetLists: AssetList[] = [
  cosmoshubAssets as unknown as AssetList,
  osmosisAssets as unknown as AssetList,
  junoAssets as unknown as AssetList,
];

// Chain names (as used by useChain / interchain-kit) available in the coordinator sign-in dropdown.
export const COORDINATOR_CHAIN_NAMES = ['cosmoshub', 'osmosis', 'juno'] as const;
export type CoordinatorChainName = (typeof COORDINATOR_CHAIN_NAMES)[number];