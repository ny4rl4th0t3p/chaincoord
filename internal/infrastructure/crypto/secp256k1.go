package crypto

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"

	"golang.org/x/crypto/ripemd160" //nolint:gosec,staticcheck // ripemd160 is required by the Cosmos address derivation spec (RIPEMD160(SHA256(pubkey)))

	"github.com/cosmos/btcutil/bech32"
	secp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const (
	compressedPubKeySize = 33
	compactSigSize       = 64
)

// Secp256k1Verifier implements ports.SignatureVerifier using secp256k1 ECDSA.
type Secp256k1Verifier struct{}

// NewSecp256k1Verifier returns a Secp256k1Verifier.
func NewSecp256k1Verifier() *Secp256k1Verifier {
	return &Secp256k1Verifier{}
}

// Verify checks that sig is a valid secp256k1 ECDSA signature over the ADR-036
// amino sign bytes derived from message and operatorAddr, AND that pubKeyB64
// (base64 of a compressed 33-byte public key) corresponds to operatorAddr via
// the Cosmos SDK address derivation convention:
// ripemd160(sha256(compressedPubKey))[0:20], bech32-encoded.
//
// The ADR-036 pre-image is sha256(amino_json(StdSignDoc)) where StdSignDoc
// wraps message as a MsgSignData payload. This matches the bytes signed by
// `gaiad tx sign --sign-mode amino-json`.
func (*Secp256k1Verifier) Verify(operatorAddr, pubKeyB64 string, message, sig []byte) error {
	if operatorAddr == "" {
		return errors.New("secp256k1: operator address is required")
	}
	if pubKeyB64 == "" {
		return errors.New("secp256k1: public key hint is required")
	}

	pubKeyBytes, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return fmt.Errorf("secp256k1: decoding public key: %w", err)
	}
	if len(pubKeyBytes) != compressedPubKeySize {
		return fmt.Errorf("secp256k1: public key must be %d bytes (compressed), got %d", compressedPubKeySize, len(pubKeyBytes))
	}

	pubKey, err := secp.ParsePubKey(pubKeyBytes)
	if err != nil {
		return fmt.Errorf("secp256k1: parsing public key: %w", err)
	}

	if err := assertSecp256k1AddressMatches(operatorAddr, pubKeyBytes); err != nil {
		return err
	}

	if len(sig) != compactSigSize {
		return fmt.Errorf("secp256k1: signature must be %d bytes (compact r‖s), got %d", compactSigSize, len(sig))
	}

	msgHash := sha256.Sum256(BuildADR036AminoBytes(operatorAddr, message))
	var r, s secp.ModNScalar
	r.SetByteSlice(sig[:32])
	s.SetByteSlice(sig[32:])
	ecdsaSig := ecdsa.NewSignature(&r, &s)
	if !ecdsaSig.Verify(msgHash[:], pubKey) {
		return errors.New("secp256k1: signature verification failed")
	}

	return nil
}

// BuildADR036AminoBytes constructs the canonical amino JSON bytes that are
// sha256-hashed and signed under ADR-036 for the given operator address and payload.
//
// The format is the Cosmos SDK StdSignDoc with chain_id="", account_number=0,
// sequence=0, and a single MsgSignData message carrying base64(payload):
//
//	{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"",
//	 "msgs":[{"type":"sign/MsgSignData","value":{"data":"<b64>","signer":"<addr>"}}],
//	 "sequence":"0"}
//
// Keys are in alphabetical order (canonical amino JSON). This matches the
// sign bytes produced by `gaiad tx sign --sign-mode amino-json`.
func BuildADR036AminoBytes(operatorAddr string, payload []byte) []byte {
	data := base64.StdEncoding.EncodeToString(payload)
	return []byte(fmt.Sprintf(
		`{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"",`+
			`"msgs":[{"type":"sign/MsgSignData","value":{"data":"%s","signer":"%s"}}],"sequence":"0"}`,
		data, operatorAddr,
	))
}

// assertSecp256k1AddressMatches verifies that compressedPubKey derives to
// operatorAddr using the Cosmos SDK secp256k1 convention:
// ripemd160(sha256(compressedPubKey))[0:20], bech32-encoded.
func assertSecp256k1AddressMatches(operatorAddr string, compressedPubKey []byte) error {
	hrp, _, err := bech32.Decode(operatorAddr, 1023)
	if err != nil {
		return fmt.Errorf("secp256k1: invalid operator address %q: %w", operatorAddr, err)
	}

	sha := sha256.Sum256(compressedPubKey)
	ripe := ripemd160.New() //nolint:gosec // ripemd160 is required by the Cosmos address derivation spec
	ripe.Write(sha[:])
	addrBytes := ripe.Sum(nil)

	converted, err := bech32.ConvertBits(addrBytes, 8, 5, true)
	if err != nil {
		return fmt.Errorf("secp256k1: converting address bits: %w", err)
	}
	derived, err := bech32.Encode(hrp, converted)
	if err != nil {
		return fmt.Errorf("secp256k1: encoding derived address: %w", err)
	}
	if derived != operatorAddr {
		return fmt.Errorf("secp256k1: public key does not correspond to address %q (derived %q)", operatorAddr, derived)
	}
	return nil
}
