package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newPubkeyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "pubkey",
		Short:   "Print the base64-encoded compressed public key for a key index",
		Example: `  smoke-signer pubkey --key-index 0   # coordinator pubkey for committee creation`,
		RunE:    runPubkey,
	}
	cmd.Flags().Int("key-index", 0, "key index (0 = coordinator, 1-4 = validators)")
	_ = cmd.MarkFlagRequired("key-index")
	return cmd
}

func runPubkey(cmd *cobra.Command, _ []string) error {
	index, _ := cmd.Flags().GetInt("key-index")
	fmt.Println(pubKeyB64(index))
	return nil
}
