// Polyfills required before any module is loaded in the jsdom test environment.
// WalletConnect (transitively imported by @interchain-kit/core) uses TextEncoder
// at module load time, which jsdom does not provide.
import { TextEncoder, TextDecoder } from 'util';

Object.assign(global, { TextEncoder, TextDecoder });