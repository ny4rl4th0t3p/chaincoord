import { buildChainSuggestion, ChainHint } from '@/utils/chainSuggestion';

const hint: ChainHint = {
  chain_id: 'mychain-1',
  chain_name: 'mychain',
  bech32_prefix: 'mychain',
  denom: 'umychain',
};

describe('buildChainSuggestion', () => {
  it('sets chainId and chainName from hint', () => {
    const { chain } = buildChainSuggestion(hint);
    expect(chain.chainId).toBe('mychain-1');
    expect(chain.chainName).toBe('mychain');
  });

  it('sets bech32Prefix from hint', () => {
    const { chain } = buildChainSuggestion(hint);
    expect(chain.bech32Prefix).toBe('mychain');
  });

  it('hardcodes slip44 to 118 (standard Cosmos coin type)', () => {
    const { chain } = buildChainSuggestion(hint);
    expect(chain.slip44).toBe(118);
  });

  it('wires the denom into feeTokens', () => {
    const { chain } = buildChainSuggestion(hint);
    expect(chain.fees?.feeTokens[0].denom).toBe('umychain');
  });

  it('wires the denom into stakingTokens', () => {
    const { chain } = buildChainSuggestion(hint);
    expect(chain.staking?.stakingTokens[0].denom).toBe('umychain');
  });

  it('uses monitorRPCURL as rpc if provided', () => {
    const { chain } = buildChainSuggestion(hint, 'http://rpc.example.com:26657');
    expect(chain.apis?.rpc?.[0]?.address).toBe('http://rpc.example.com:26657');
  });

  it('sets rpc to empty array when monitorRPCURL is not provided', () => {
    const { chain } = buildChainSuggestion(hint);
    expect(chain.apis?.rpc).toHaveLength(0);
  });

  it('sets chainName on the assetList', () => {
    const { assetList } = buildChainSuggestion(hint);
    expect(assetList.chainName).toBe('mychain');
  });

  it('includes one asset with the correct base denom', () => {
    const { assetList } = buildChainSuggestion(hint);
    expect(assetList.assets).toHaveLength(1);
    expect(assetList.assets[0].base).toBe('umychain');
  });

  it('strips leading u from denom for the display/symbol', () => {
    const { assetList } = buildChainSuggestion(hint);
    const asset = assetList.assets[0];
    expect(asset.display).toBe('mychain');
    expect(asset.symbol).toBe('MYCHAIN');
  });
});