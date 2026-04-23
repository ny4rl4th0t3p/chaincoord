import { Chain, AssetList } from '@chain-registry/v2-types';

export interface ChainHint {
  chain_id: string;
  chain_name: string;
  bech32_prefix: string;
  denom: string;
}

/**
 * Assembles a chain-registry v2 Chain + AssetList from a /launch/:id/chain-hint response.
 * Hardcodes coinType 118 (standard for all Cosmos chains).
 * Uses monitorRPCURL as the rpc endpoint if provided, otherwise "".
 */
export function buildChainSuggestion(
  hint: ChainHint,
  monitorRPCURL?: string,
): { chain: Chain; assetList: AssetList } {
  const { chain_id, chain_name, bech32_prefix, denom } = hint;
  const rpc = monitorRPCURL ?? '';

  const chain: Chain = {
    chainName: chain_name,
    chainId: chain_id,
    prettyName: chain_name,
    bech32Prefix: bech32_prefix,
    slip44: 118,
    fees: {
      feeTokens: [
        {
          denom,
          fixedMinGasPrice: 0,
          lowGasPrice: 0.025,
          averageGasPrice: 0.025,
          highGasPrice: 0.04,
        },
      ],
    },
    staking: {
      stakingTokens: [{ denom }],
    },
    apis: {
      rpc: rpc ? [{ address: rpc, provider: 'monitor' }] : [],
      rest: [],
    },
    status: 'upcoming',
    networkType: 'mainnet',
    website: '',
    logo: undefined,
  } as unknown as Chain;

  const assetList: AssetList = {
    chainName: chain_name,
    assets: [
      {
        description: `${chain_name} staking token`,
        denomUnits: [
          { denom, exponent: 0 },
          { denom: denom.replace(/^u/, ''), exponent: 6 },
        ],
        base: denom,
        name: chain_name,
        display: denom.replace(/^u/, ''),
        symbol: denom.replace(/^u/, '').toUpperCase(),
        typeAsset: 'sdk.coin',
      },
    ],
  } as unknown as AssetList;

  return { chain, assetList };
}