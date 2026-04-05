package launch

// GenesisAccount is a pre-funded account declared in the genesis file.
// Managed by ADD_GENESIS_ACCOUNT, REMOVE_GENESIS_ACCOUNT, and
// MODIFY_GENESIS_ACCOUNT committee proposals.
type GenesisAccount struct {
	Address         string  // bech32 address
	Amount          string  // e.g. "1000000utoken"
	VestingSchedule *string // JSON blob describing vesting; nil = fully liquid
}
