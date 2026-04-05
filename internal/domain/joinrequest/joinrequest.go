// Package joinrequest contains the JoinRequest aggregate.
package joinrequest

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ny4rl4th0t3p/chaincoord/internal/domain/launch"
)

// Status is the join request lifecycle state.
type Status string

const (
	StatusPending  Status = "PENDING"
	StatusApproved Status = "APPROVED"
	StatusRejected Status = "REJECTED"
	StatusExpired  Status = "EXPIRED"
)

// JoinRequest is the aggregate root for a validator's application to join a genesis.
type JoinRequest struct {
	ID              uuid.UUID
	LaunchID        uuid.UUID
	OperatorAddress launch.OperatorAddress
	ConsensusPubKey string // base64 Ed25519 consensus pubkey (validator consensus key, not operator key)
	GentxJSON       json.RawMessage
	PeerAddress     launch.PeerAddress
	RPCEndpoint     launch.RPCEndpoint
	Memo            string
	SubmittedAt     time.Time
	// Signature is the operator's secp256k1 sig over canonical JSON of this request.
	OperatorSignature launch.Signature

	Status             Status
	RejectionReason    string
	ApprovedByProposal *uuid.UUID // set when approved
}

// New creates a new JoinRequest in PENDING status and validates it against the
// provided chain record. Validation is structural only — no binary is invoked.
func New(
	id uuid.UUID,
	launchID uuid.UUID,
	operatorAddr launch.OperatorAddress,
	consensusPubKey string,
	gentxJSON json.RawMessage,
	peerAddr launch.PeerAddress,
	rpcEndpoint launch.RPCEndpoint,
	memo string,
	sig launch.Signature,
	chainRecord launch.ChainRecord,
	launchType launch.LaunchType,
	now time.Time,
) (*JoinRequest, error) {
	jr := &JoinRequest{
		ID:                id,
		LaunchID:          launchID,
		OperatorAddress:   operatorAddr,
		ConsensusPubKey:   consensusPubKey,
		GentxJSON:         gentxJSON,
		PeerAddress:       peerAddr,
		RPCEndpoint:       rpcEndpoint,
		Memo:              memo,
		SubmittedAt:       now,
		OperatorSignature: sig,
		Status:            StatusPending,
	}

	if err := jr.validate(chainRecord, launchType, now); err != nil {
		return nil, err
	}
	return jr, nil
}

// Approve marks the request as approved and records the approving proposal ID.
func (jr *JoinRequest) Approve(proposalID uuid.UUID) error {
	if jr.Status != StatusPending {
		return fmt.Errorf("join request: can only approve PENDING requests, current status: %s", jr.Status)
	}
	jr.Status = StatusApproved
	jr.ApprovedByProposal = &proposalID
	return nil
}

// Reject marks the request as rejected with a reason.
func (jr *JoinRequest) Reject(reason string) error {
	if jr.Status != StatusPending {
		return fmt.Errorf("join request: can only reject PENDING requests, current status: %s", jr.Status)
	}
	jr.Status = StatusRejected
	jr.RejectionReason = reason
	return nil
}

// Expire marks the request as expired (window closed with no decision).
func (jr *JoinRequest) Expire() error {
	if jr.Status != StatusPending {
		return fmt.Errorf("join request: can only expire PENDING requests, current status: %s", jr.Status)
	}
	jr.Status = StatusExpired
	return nil
}

// Revoke transitions an APPROVED request back to a terminal REJECTED state.
// Used by the REMOVE_APPROVED_VALIDATOR proposal flow.
func (jr *JoinRequest) Revoke(reason string) error {
	if jr.Status != StatusApproved {
		return fmt.Errorf("join request: can only revoke APPROVED requests, current status: %s", jr.Status)
	}
	jr.Status = StatusRejected
	jr.RejectionReason = reason
	jr.ApprovedByProposal = nil
	return nil
}

// validate applies the structural validation rules from spec §2.4.
// This does not call the chain binary — all checks are pure Go.
func (jr *JoinRequest) validate(record launch.ChainRecord, lt launch.LaunchType, now time.Time) error {
	// Window check
	if now.After(record.GentxDeadline) {
		return fmt.Errorf("gentx submission deadline has passed (%s)", record.GentxDeadline.Format(time.RFC3339))
	}

	// Consensus pubkey must be present
	if jr.ConsensusPubKey == "" {
		return fmt.Errorf("consensus pubkey is required")
	}

	// Parse and structurally validate the gentx JSON
	gentxChainID, selfDelegation, err := extractGentxFields(jr.GentxJSON)
	if err != nil {
		return fmt.Errorf("gentx: %w", err)
	}

	// chain_id must match when present. Cosmos SDK v0.50+ (Gaia v27+) uses SIGN_MODE_DIRECT
	// and omits chain_id from the plaintext tx JSON — it is only in the signed SignDoc bytes.
	// When absent, defer the check to `gaiad genesis validate` during genesis assembly.
	if gentxChainID != "" && gentxChainID != record.ChainID {
		return fmt.Errorf("gentx chain_id %q does not match chain record %q", gentxChainID, record.ChainID)
	}

	// Self-delegation floor (mainnet and incentivized testnet)
	if lt == launch.LaunchTypeMainnet || lt == launch.LaunchTypeIncentivizedTestnet || lt == launch.LaunchTypePermissioned {
		if record.MinSelfDelegation != "" && selfDelegation < mustParseInt64(record.MinSelfDelegation) {
			return fmt.Errorf("self_delegation %d is below min_self_delegation %s", selfDelegation, record.MinSelfDelegation)
		}
	}

	// Commission rate limits (mainnet and permissioned only — spec §2.4)
	if lt == launch.LaunchTypeMainnet || lt == launch.LaunchTypePermissioned {
		if err := jr.validateCommission(record); err != nil {
			return err
		}
	}

	return nil
}

func (jr *JoinRequest) validateCommission(record launch.ChainRecord) error {
	commission, err := extractGentxCommission(jr.GentxJSON)
	if err != nil {
		return fmt.Errorf("gentx commission: %w", err)
	}
	if commission.Rate != "" {
		rate, err := launch.NewCommissionRate(commission.Rate)
		if err != nil {
			return fmt.Errorf("gentx commission.rate: %w", err)
		}
		if !rate.LessThanOrEqual(record.MaxCommissionRate) {
			return fmt.Errorf("gentx commission_rate %s exceeds max_commission_rate %s", commission.Rate, record.MaxCommissionRate)
		}
	}
	if commission.MaxChangeRate != "" {
		maxChange, err := launch.NewCommissionRate(commission.MaxChangeRate)
		if err != nil {
			return fmt.Errorf("gentx commission.max_change_rate: %w", err)
		}
		if !maxChange.LessThanOrEqual(record.MaxCommissionChangeRate) {
			return fmt.Errorf(
				"gentx max_commission_change_rate %s exceeds max_commission_change_rate %s",
				commission.MaxChangeRate,
				record.MaxCommissionChangeRate,
			)
		}
	}
	return nil
}

type gentxCommission struct {
	Rate          string
	MaxChangeRate string
}

// extractGentxCommission extracts commission.rate and commission.max_change_rate from
// body.messages[0].commission of the gentx JSON. Returns empty strings if not present.
func extractGentxCommission(gentxJSON json.RawMessage) (gentxCommission, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(gentxJSON, &raw); err != nil {
		return gentxCommission{}, fmt.Errorf("not valid JSON: %w", err)
	}
	bodyRaw, ok := raw["body"]
	if !ok {
		return gentxCommission{}, nil
	}
	var body struct {
		Messages []json.RawMessage `json:"messages"`
	}
	if err := json.Unmarshal(bodyRaw, &body); err != nil || len(body.Messages) == 0 {
		return gentxCommission{}, nil
	}
	var msg struct {
		Commission struct {
			Rate          string `json:"rate"`
			MaxChangeRate string `json:"max_change_rate"`
		} `json:"commission"`
	}
	if err := json.Unmarshal(body.Messages[0], &msg); err != nil {
		return gentxCommission{}, nil
	}
	return gentxCommission{
		Rate:          msg.Commission.Rate,
		MaxChangeRate: msg.Commission.MaxChangeRate,
	}, nil
}

// extractGentxFields parses the gentx JSON to extract chain_id and self_delegation amount.
//
// Two gentx formats are supported:
//   - Pre-SDK-v0.50 (e.g. Gaia ≤v20): chain_id at top level; value.amount as "<int><denom>" string.
//   - SDK v0.50+ / SIGN_MODE_DIRECT (e.g. Gaia v27+): no chain_id in plaintext JSON (only in
//     signed SignDoc bytes); value is a Coin object {"denom":"...","amount":"<int>"}.
//
// Returns chainID="" when absent; callers must treat that as unverifiable, not as a mismatch.
// Full semantic validation (including chain_id) is deferred to the chain binary at genesis assembly.
func extractGentxFields(gentxJSON json.RawMessage) (chainID string, selfDelegation int64, err error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(gentxJSON, &raw); err != nil {
		return "", 0, fmt.Errorf("not valid JSON: %w", err)
	}

	// chain_id is present in pre-SDK-v0.50 gentx envelopes; absent in v0.50+ SIGN_MODE_DIRECT.
	if chainIDRaw, ok := raw["chain_id"]; ok {
		if err := json.Unmarshal(chainIDRaw, &chainID); err != nil {
			return "", 0, fmt.Errorf("chain_id: %w", err)
		}
	}

	// Extract self_delegation from body.messages[0].value.amount (best-effort).
	// Both formats share the same .amount field — pre-v0.50 embeds the denom in the string
	// ("100000000uatom") while v0.50+ uses a Coin struct with a separate .denom field.
	// parseAmountString handles both by stopping at the first non-digit character.
	if bodyRaw, ok := raw["body"]; ok {
		var body struct {
			Messages []json.RawMessage `json:"messages"`
		}
		if err := json.Unmarshal(bodyRaw, &body); err == nil && len(body.Messages) > 0 {
			var msg struct {
				Value struct {
					Amount string `json:"amount"`
				} `json:"value"`
			}
			if err := json.Unmarshal(body.Messages[0], &msg); err == nil {
				selfDelegation = parseAmountString(msg.Value.Amount)
			}
		}
	}

	return chainID, selfDelegation, nil
}

// SelfDelegationAmount parses and returns the self-delegation amount from the gentx.
// Returns 0 if it cannot be determined.
func (jr *JoinRequest) SelfDelegationAmount() int64 {
	_, amount, _ := extractGentxFields(jr.GentxJSON)
	return amount
}

// Moniker returns the validator moniker from the gentx description.
// Returns an empty string if it cannot be determined.
func (jr *JoinRequest) Moniker() string {
	return extractGentxMoniker(jr.GentxJSON)
}

func extractGentxMoniker(gentxJSON json.RawMessage) string {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(gentxJSON, &raw); err != nil {
		return ""
	}
	bodyRaw, ok := raw["body"]
	if !ok {
		return ""
	}
	var body struct {
		Messages []json.RawMessage `json:"messages"`
	}
	if err := json.Unmarshal(bodyRaw, &body); err != nil || len(body.Messages) == 0 {
		return ""
	}
	var msg struct {
		Description struct {
			Moniker string `json:"moniker"`
		} `json:"description"`
	}
	if err := json.Unmarshal(body.Messages[0], &msg); err != nil {
		return ""
	}
	return msg.Description.Moniker
}

// parseAmountString extracts the integer part from a Cosmos amount string like "1000000utoken".
func parseAmountString(s string) int64 {
	var n int64
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int64(c-'0')
		} else {
			break
		}
	}
	return n
}

func mustParseInt64(s string) int64 {
	return parseAmountString(s)
}
