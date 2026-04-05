package cmd

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"

	"golang.org/x/crypto/ripemd160" //nolint:gosec,staticcheck // ripemd160 is required by the Cosmos address derivation spec

	"github.com/cosmos/btcutil/bech32"
	secp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const seedPrefix = "chaincoord-smoke-signer-v1:"

// compressedPubKey returns the 33-byte compressed public key for the given index.
func compressedPubKey(index int) []byte {
	seed := sha256.Sum256([]byte(fmt.Sprintf("%s%d", seedPrefix, index)))
	return secp.PrivKeyFromBytes(seed[:]).PubKey().SerializeCompressed()
}

// pubKeyB64 returns the base64-encoded compressed public key for the given index.
func pubKeyB64(index int) string {
	return base64.StdEncoding.EncodeToString(compressedPubKey(index))
}

// privKeyHex returns the raw private key bytes as a hex string (for gaiad import-hex).
func privKeyHex(index int) string {
	seed := sha256.Sum256([]byte(fmt.Sprintf("%s%d", seedPrefix, index)))
	return hex.EncodeToString(secp.PrivKeyFromBytes(seed[:]).Serialize())
}

// deriveAddress returns the bech32 address for the given key index and HRP.
// Derivation follows the Cosmos SDK convention: bech32(hrp, ripemd160(sha256(pubkey))).
func deriveAddress(index int, hrp string) (string, error) {
	pub := compressedPubKey(index)
	sha := sha256.Sum256(pub)
	ripe := ripemd160.New() //nolint:gosec // ripemd160 is required by the Cosmos address derivation spec
	ripe.Write(sha[:])
	addrBytes := ripe.Sum(nil)

	converted, err := bech32.ConvertBits(addrBytes, 8, 5, true)
	if err != nil {
		return "", fmt.Errorf("converting address bits: %w", err)
	}
	addr, err := bech32.Encode(hrp, converted)
	if err != nil {
		return "", fmt.Errorf("encoding address: %w", err)
	}
	return addr, nil
}

// signADR036 signs payload using ADR-036 amino bytes for the given key index.
// Returns the 64-byte compact r‖s signature (recovery byte stripped), base64-encoded.
func signADR036(index int, signerAddr string, payload []byte) string {
	seed := sha256.Sum256([]byte(fmt.Sprintf("%s%d", seedPrefix, index)))
	privKey := secp.PrivKeyFromBytes(seed[:])
	adr036 := buildADR036AminoBytes(signerAddr, payload)
	msgHash := sha256.Sum256(adr036)
	compactSig := ecdsa.SignCompact(privKey, msgHash[:], true)
	return base64.StdEncoding.EncodeToString(compactSig[1:]) // strip 1-byte recovery flag
}

// buildADR036AminoBytes constructs the canonical amino JSON sign bytes used by ADR-036.
// Matches internal/infrastructure/crypto.BuildADR036AminoBytes exactly.
func buildADR036AminoBytes(signerAddr string, payload []byte) []byte {
	data := base64.StdEncoding.EncodeToString(payload)
	return []byte(fmt.Sprintf(
		`{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"",`+
			`"msgs":[{"type":"sign/MsgSignData","value":{"data":"%s","signer":"%s"}}],"sequence":"0"}`,
		data, signerAddr,
	))
}
