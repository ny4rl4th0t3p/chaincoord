import { create } from 'zustand';

// No global chain — each launch has its own chain registered on the launch detail page.
interface ChainStore {
  selectedChain: string;
}

export const useChainStore = create<ChainStore>()(() => ({
  selectedChain: '',
}));

export const chainStore = {
  setSelectedChain: (chainName: string) => {
    useChainStore.setState({ selectedChain: chainName });
  },
};
