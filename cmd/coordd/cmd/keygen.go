package cmd

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/spf13/cobra"
)

func newKeygenCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "keygen",
		Short: "Generate a random Ed25519 seed for use as a signing key",
		Long: `Generate a cryptographically random 32-byte Ed25519 seed and print it as
base64 to stdout. Use this to produce values for COORD_AUDIT_PRIVATE_KEY
and COORD_JWT_PRIVATE_KEY (run it twice — the two keys must be different).

For production deployments, pipe the output directly into your secrets
manager rather than echoing it to a terminal or shell history:

  coordd keygen | docker secret create audit_key -
  coordd keygen | docker secret create jwt_key -`,
		RunE: runKeygen,
	}
}

func runKeygen(_ *cobra.Command, _ []string) error {
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		return fmt.Errorf("generating random seed: %w", err)
	}
	fmt.Println(base64.StdEncoding.EncodeToString(seed))
	return nil
}
