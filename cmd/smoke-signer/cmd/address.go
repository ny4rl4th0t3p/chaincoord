package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newAddressCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "address",
		Short: "Print the bech32 operator address for a key index",
		Example: `  smoke-signer address --key-index 0
  smoke-signer address --key-index 1 --hrp cosmos`,
		RunE: runAddress,
	}
	cmd.Flags().Int("key-index", 0, "key index (0 = coordinator, 1-4 = validators)")
	cmd.Flags().String("hrp", "cosmos", "bech32 human-readable part")
	_ = cmd.MarkFlagRequired("key-index")
	return cmd
}

func runAddress(cmd *cobra.Command, _ []string) error {
	index, _ := cmd.Flags().GetInt("key-index")
	hrp, _ := cmd.Flags().GetString("hrp")
	addr, err := deriveAddress(index, hrp)
	if err != nil {
		return err
	}
	fmt.Println(addr)
	return nil
}
