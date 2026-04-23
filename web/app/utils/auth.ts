/**
 * Builds the canonical JSON payload that must be passed to signArbitrary.
 *
 * The field order MUST be alphabetical (challenge → operator_address → timestamp)
 * to match canonicaljson.MarshalForSigning on the Go server.
 * No whitespace. Timestamp must be RFC 3339 UTC with second precision.
 *
 * Pinned by the contract test in internal/application/services/auth_contract_test.go.
 */
export function buildAuthPayload(
  address: string,
  challenge: string,
  timestamp: string,
): string {
  // JSON.stringify preserves insertion order — keys inserted in alphabetical order.
  return JSON.stringify({
    challenge,
    operator_address: address,
    timestamp,
  });
}

/** Returns current UTC time as RFC 3339 with second precision (no milliseconds). */
export function nowTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Generates a random nonce for replay protection. */
export function generateNonce(): string {
  return crypto.randomUUID();
}