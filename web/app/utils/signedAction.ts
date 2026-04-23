import { CosmosWallet } from '@interchain-kit/core';
import { StatefulWallet } from '@interchain-kit/react/store/stateful-wallet';
import { generateNonce, nowTimestamp } from './auth';

/**
 * Recursively produces canonical JSON: sorted object keys at every level, no whitespace.
 *
 * Mirrors canonicaljson.canonicalise() in pkg/canonicaljson/canonicaljson.go.
 * Top-level call strips 'nonce', 'signature', 'pubkey_b64' before recursing —
 * matching canonicaljson.MarshalForSigning.
 *
 * This matters for payloads that contain nested objects (e.g. the `gentx` field
 * in SubmitInput, or `payload` in RaiseInput) — shallow key sorting is not enough.
 */
export function buildCanonicalActionPayload(
  payload: Record<string, unknown>,
): string {
  const stripped = { ...payload };
  delete stripped.nonce;
  delete stripped.signature;
  delete stripped.pubkey_b64;

  return canonicalValue(stripped);
}

/** Recursively serialises a value with sorted object keys and no whitespace. */
function canonicalValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(canonicalValue).join(',') + ']';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const pairs = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalValue(obj[k])}`);
    return '{' + pairs.join(',') + '}';
  }
  // undefined fields — JSON.stringify omits them; match that behaviour
  return 'null';
}

/**
 * Signs an action payload using the wallet's signArbitrary and returns the full
 * body ready to POST — payload fields + nonce, timestamp, pubkey_b64, signature.
 *
 * Adds `timestamp` if not already present in the payload.
 */
export async function buildSignedAction<T extends Record<string, unknown>>(
  payload: T,
  wallet: StatefulWallet,
  chainId: string,
  address: string,
): Promise<T & { nonce: string; timestamp: string; pubkey_b64: string; signature: string }> {
  const timestamp = nowTimestamp();
  const nonce = generateNonce();

  const forSigning = buildCanonicalActionPayload({ ...payload, timestamp });

  const cosmosWallet =
    wallet?.getWalletOfType?.(CosmosWallet) ??
    (wallet?.originalWallet as any)?.getWalletByChainType?.('cosmos') ??
    (typeof (wallet?.originalWallet as any)?.signArbitrary === 'function'
      ? (wallet.originalWallet as any)
      : null);

  let stdSig: { pub_key: { value: string }; signature: string };
  if (cosmosWallet) {
    stdSig = await cosmosWallet.signArbitrary(chainId, address, forSigning);
  } else if (typeof (window as any).keplr?.signArbitrary === 'function') {
    stdSig = await (window as any).keplr.signArbitrary(chainId, address, forSigning);
  } else {
    throw new Error('No Cosmos wallet found — connect Keplr or Leap first');
  }

  return {
    ...payload,
    timestamp,
    nonce,
    pubkey_b64: stdSig.pub_key.value,
    signature: stdSig.signature,
  } as T & { nonce: string; timestamp: string; pubkey_b64: string; signature: string };
}