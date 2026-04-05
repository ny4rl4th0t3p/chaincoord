package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

var cfgFile string

// Execute is the entry point called by main.
func Execute() {
	if err := newRootCmd().Execute(); err != nil {
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "coordd",
		Short: "Chain launch coordination server",
	}

	root.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default: config.yaml in ., $HOME/.coordd, /etc/coordd)")

	root.AddCommand(
		newServeCmd(),
		newMigrateCmd(),
		newKeygenCmd(),
		newVersionCmd(),
		newAuditCmd(),
	)
	return root
}
