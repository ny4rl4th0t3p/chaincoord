package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newPrivkeyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "privkey",
		Short: "Print the raw private key as hex (for gaiad keys import-hex)",
		Example: `  smoke-signer privkey --key-index 1
  gaiad keys import-hex operator $(smoke-signer privkey --key-index 1) --keyring-backend test`,
		RunE: runPrivkey,
	}
	cmd.Flags().Int("key-index", 0, "key index (0 = coordinator, 1-4 = validators)")
	_ = cmd.MarkFlagRequired("key-index")
	return cmd
}

func runPrivkey(cmd *cobra.Command, _ []string) error {
	index, _ := cmd.Flags().GetInt("key-index")
	fmt.Println(privKeyHex(index))
	return nil
}
