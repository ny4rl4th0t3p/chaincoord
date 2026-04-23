import { Secp256k1, sha256, ripemd160 } from '@cosmjs/crypto';
import { toBase64, toBech32 } from '@cosmjs/encoding';

// Deterministic test private keys. Never use in production.
const COORDINATOR_PRIVKEY = new Uint8Array(32).fill(0x01);
const VALIDATOR_PRIVKEY = new Uint8Array(32).fill(0x02);

export interface TestKeypair {
  /** bech32 address derived with the given prefix */
  address(prefix: string): string;
  /** base64-encoded 33-byte compressed public key */
  pubKeyB64: string;
  /**
   * Replicates Keplr's signArbitrary: builds the ADR-036 amino sign doc,
   * SHA-256 hashes it, and signs with secp256k1. Returns a StdSignature.
   */
  signArbitrary(
    chainId: string,
    address: string,
    message: string,
  ): Promise<{ pub_key: { type: string; value: string }; signature: string }>;
}

function buildADR036AminoBytes(operatorAddr: string, payload: string): Uint8Array {
  // Must match BuildADR036AminoBytes in internal/infrastructure/crypto/secp256k1.go exactly.
  const data = Buffer.from(payload).toString('base64');
  const aminoJson =
    `{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"",` +
    `"msgs":[{"type":"sign/MsgSignData","value":{"data":"${data}","signer":"${operatorAddr}"}}],"sequence":"0"}`;
  return Buffer.from(aminoJson);
}

async function makeTestKeypair(privKeyBytes: Uint8Array): Promise<TestKeypair> {
  const kp = await Secp256k1.makeKeypair(privKeyBytes);
  const compressedPubKey = Secp256k1.compressPubkey(kp.pubkey);
  const addrBytes = ripemd160(sha256(compressedPubKey));
  const pubKeyB64 = toBase64(compressedPubKey);

  return {
    address(prefix: string): string {
      return toBech32(prefix, addrBytes);
    },
    pubKeyB64,
    async signArbitrary(_chainId, address, message) {
      const aminoBytes = buildADR036AminoBytes(address, message);
      const hash = sha256(aminoBytes);
      const sig = await Secp256k1.createSignature(hash, privKeyBytes);
      // createSignature returns ExtendedSecp256k1Signature whose toFixedLength() is 65 bytes (r‖s‖recovery).
      // Go's verifier expects compact 64-byte r‖s — build it manually.
      const sig64 = new Uint8Array(64);
      sig64.set(sig.r(32), 0);
      sig64.set(sig.s(32), 32);
      return {
        pub_key: { type: 'tendermint/PubKeySecp256k1', value: pubKeyB64 },
        signature: toBase64(sig64),
      };
    },
  };
}

// Lazily initialised singletons — call initKeypairs() in globalSetup before use.
let _coordinator: TestKeypair;
let _validator: TestKeypair;

export async function initKeypairs(): Promise<void> {
  if (_coordinator && _validator) return;
  [_coordinator, _validator] = await Promise.all([
    makeTestKeypair(COORDINATOR_PRIVKEY),
    makeTestKeypair(VALIDATOR_PRIVKEY),
  ]);
}

export function coordinator(): TestKeypair {
  if (!_coordinator) throw new Error('initKeypairs() not called');
  return _coordinator;
}

export function validator(): TestKeypair {
  if (!_validator) throw new Error('initKeypairs() not called');
  return _validator;
}
