package crypto

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/cosmos/btcutil/bech32"
)

// Ed25519Verifier implements ports.SignatureVerifier using standard Ed25519.
type Ed25519Verifier struct{}

// NewEd25519Verifier returns an Ed25519Verifier.
func NewEd25519Verifier() *Ed25519Verifier {
	return &Ed25519Verifier{}
}

// Verify checks that sig is a valid Ed25519 signature over message, AND that
// pubKeyB64 corresponds to operatorAddr via the Cosmos SDK address derivation
// algorithm (sha256(pubkeyBytes)[0:20], bech32-encoded with the address's HRP).
//
// Both operatorAddr and pubKeyB64 are required. Supplying a pubkey that does
// not derive to operatorAddr is rejected even if the signature is otherwise
// valid — this prevents a caller from claiming an address they do not own.
func (*Ed25519Verifier) Verify(operatorAddr, pubKeyB64 string, message, sig []byte) error {
	if operatorAddr == "" {
		return errors.New("ed25519: operator address is required")
	}
	if pubKeyB64 == "" {
		return errors.New("ed25519: public key hint is required")
	}
	pubKey, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return fmt.Errorf("ed25519: decoding public key: %w", err)
	}
	if len(pubKey) != ed25519.PublicKeySize {
		return fmt.Errorf("ed25519: public key must be %d bytes, got %d", ed25519.PublicKeySize, len(pubKey))
	}
	if err := assertAddressMatchesPubKey(operatorAddr, pubKey); err != nil {
		return err
	}
	if !ed25519.Verify(pubKey, message, sig) {
		return errors.New("ed25519: signature verification failed")
	}
	return nil
}

// assertAddressMatchesPubKey verifies that pubKey derives to operatorAddr using
// the Cosmos SDK Ed25519 convention: address = sha256(pubkeyBytes)[0:20],
// bech32-encoded with the HRP present in operatorAddr.
func assertAddressMatchesPubKey(operatorAddr string, pubKey []byte) error {
	hrp, _, err := bech32.Decode(operatorAddr, 1023)
	if err != nil {
		return fmt.Errorf("ed25519: invalid operator address %q: %w", operatorAddr, err)
	}
	hash := sha256.Sum256(pubKey)
	addrBytes := hash[:20]
	converted, err := bech32.ConvertBits(addrBytes, 8, 5, true)
	if err != nil {
		return fmt.Errorf("ed25519: converting address bits: %w", err)
	}
	derived, err := bech32.Encode(hrp, converted)
	if err != nil {
		return fmt.Errorf("ed25519: encoding derived address: %w", err)
	}
	if derived != operatorAddr {
		return fmt.Errorf("ed25519: public key does not correspond to address %q (derived %q)", operatorAddr, derived)
	}
	return nil
}
