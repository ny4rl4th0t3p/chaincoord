package joinrequest_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ny4rl4th0t3p/chaincoord/internal/domain/joinrequest"
	"github.com/ny4rl4th0t3p/chaincoord/internal/domain/launch"
)

// --- helpers ---

const testOperatorAddr = "cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu"

func addr() launch.OperatorAddress {
	return launch.MustNewOperatorAddress(testOperatorAddr)
}

func peer() launch.PeerAddress {
	p, _ := launch.NewPeerAddress("abcdef1234567890abcdef1234567890abcdef12@192.168.1.1:26656")
	return p
}

func rpc() launch.RPCEndpoint {
	r, _ := launch.NewRPCEndpoint("https://192.168.1.1:26657")
	return r
}

func sig() launch.Signature {
	s, _ := launch.NewSignature("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	return s
}

func baseRecord() launch.ChainRecord {
	return launch.ChainRecord{
		ChainID:               "testchain-1",
		ChainName:             "Test Chain",
		BinaryName:            "testchaind",
		BinaryVersion:         "v1.0.0",
		Denom:                 "utest",
		MinSelfDelegation:     "1000000",
		GentxDeadline:         time.Now().Add(24 * time.Hour),
		ApplicationWindowOpen: time.Now(),
		MinValidatorCount:     4,
	}
}

func mainnetRecord() launch.ChainRecord {
	r := baseRecord()
	r.MaxCommissionRate, _ = launch.NewCommissionRate("0.20")
	r.MaxCommissionChangeRate, _ = launch.NewCommissionRate("0.01")
	return r
}

// makeGentx builds a minimal gentx JSON with the given chain_id and self-delegation amount.
func makeGentx(chainID string, selfDelegation int64) json.RawMessage {
	return makeGentxWithCommission(chainID, selfDelegation, "", "")
}

// makeGentxV27 builds a gentx JSON in Cosmos SDK v0.50+ / SIGN_MODE_DIRECT format:
// no top-level chain_id, and value as a Coin struct {"denom":"utest","amount":"<int>"}.
func makeGentxV27(selfDelegation int64) json.RawMessage {
	msg := map[string]any{
		"@type": "/cosmos.staking.v1beta1.MsgCreateValidator",
		"value": map[string]any{
			"denom":  "utest",
			"amount": itoa(selfDelegation),
		},
	}
	gentx := map[string]any{
		"body": map[string]any{
			"messages": []any{msg},
		},
		"auth_info":  map[string]any{},
		"signatures": []any{},
	}
	b, _ := json.Marshal(gentx)
	return b
}

// makeGentxWithCommission builds a gentx JSON including optional commission fields.
// Pass empty strings for commissionRate / maxChangeRate to omit them.
func makeGentxWithCommission(chainID string, selfDelegation int64, commissionRate, maxChangeRate string) json.RawMessage {
	msg := map[string]any{
		"@type": "/cosmos.staking.v1beta1.MsgCreateValidator",
		"value": map[string]any{
			"amount": itoa(selfDelegation) + "utest",
		},
	}
	if commissionRate != "" || maxChangeRate != "" {
		msg["commission"] = map[string]any{
			"rate":            commissionRate,
			"max_change_rate": maxChangeRate,
		}
	}
	gentx := map[string]any{
		"chain_id": chainID,
		"body": map[string]any{
			"messages": []any{msg},
		},
	}
	b, _ := json.Marshal(gentx)
	return b
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

func newJR(chainID string, selfDelegation int64, record launch.ChainRecord, lt launch.LaunchType) (*joinrequest.JoinRequest, error) {
	return joinrequest.New(
		uuid.New(),
		uuid.New(),
		addr(),
		"AAAA", // consensus pubkey (non-empty)
		makeGentx(chainID, selfDelegation),
		peer(),
		rpc(),
		"",
		sig(),
		record,
		lt,
		time.Now(),
	)
}

// --- tests ---

func TestNew_HappyPath_Testnet(t *testing.T) {
	jr, err := newJR("testchain-1", 100, baseRecord(), launch.LaunchTypeTestnet)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if jr.Status != joinrequest.StatusPending {
		t.Errorf("expected PENDING, got %s", jr.Status)
	}
}

func TestNew_HappyPath_Mainnet_SufficientDelegation(t *testing.T) {
	_, err := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeMainnet)
	if err != nil {
		t.Fatalf("unexpected error for sufficient delegation: %v", err)
	}
}

func TestNew_ChainIDMismatch(t *testing.T) {
	_, err := newJR("wrongchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	if err == nil {
		t.Error("expected error: chain_id mismatch")
	}
}

// TestNew_V27GentxFormat_NoChainID verifies that a Cosmos SDK v0.50+ / SIGN_MODE_DIRECT
// gentx (no top-level chain_id, Coin value struct) is accepted. chain_id validation is
// deferred to the chain binary at genesis assembly time.
func TestNew_V27GentxFormat_NoChainID(t *testing.T) {
	_, err := joinrequest.New(
		uuid.New(), uuid.New(), addr(), "AAAA",
		makeGentxV27(1000000),
		peer(), rpc(), "", sig(),
		baseRecord(), launch.LaunchTypeTestnet, time.Now(),
	)
	if err != nil {
		t.Fatalf("v27 gentx (no chain_id) should be accepted: %v", err)
	}
}

// TestNew_V27GentxFormat_SelfDelegation verifies self-delegation is correctly extracted
// from the Coin value struct {"denom":"...","amount":"<int>"} used in v27 gentx.
func TestNew_V27GentxFormat_SelfDelegation(t *testing.T) {
	_, err := joinrequest.New(
		uuid.New(), uuid.New(), addr(), "AAAA",
		makeGentxV27(500000),
		peer(), rpc(), "", sig(),
		baseRecord(), launch.LaunchTypeMainnet, time.Now(),
	)
	if err == nil {
		t.Error("expected self_delegation below min_self_delegation for mainnet")
	}
}

func TestNew_BelowMinSelfDelegation_Mainnet(t *testing.T) {
	_, err := newJR("testchain-1", 500000, baseRecord(), launch.LaunchTypeMainnet)
	if err == nil {
		t.Error("expected error: self_delegation below min_self_delegation for mainnet")
	}
}

func TestNew_BelowMinSelfDelegation_IncentivizedTestnet(t *testing.T) {
	_, err := newJR("testchain-1", 500000, baseRecord(), launch.LaunchTypeIncentivizedTestnet)
	if err == nil {
		t.Error("expected error: self_delegation below min_self_delegation for incentivized testnet")
	}
}

func TestNew_BelowMinSelfDelegation_Testnet_Allowed(t *testing.T) {
	// Testnets do not enforce min_self_delegation
	_, err := newJR("testchain-1", 1, baseRecord(), launch.LaunchTypeTestnet)
	if err != nil {
		t.Errorf("unexpected error for testnet with low delegation: %v", err)
	}
}

func TestNew_MissingConsensusPubKey(t *testing.T) {
	record := baseRecord()
	_, err := joinrequest.New(
		uuid.New(), uuid.New(),
		addr(),
		"", // empty pubkey
		makeGentx("testchain-1", 1000000),
		peer(), rpc(), "", sig(),
		record, launch.LaunchTypeTestnet, time.Now(),
	)
	if err == nil {
		t.Error("expected error: empty consensus pubkey")
	}
}

func TestNew_DeadlinePassed(t *testing.T) {
	record := baseRecord()
	record.GentxDeadline = time.Now().Add(-1 * time.Hour) // in the past
	_, err := newJR("testchain-1", 1000000, record, launch.LaunchTypeTestnet)
	if err == nil {
		t.Error("expected error: gentx deadline passed")
	}
}

func TestNew_MalformedGentxJSON(t *testing.T) {
	_, err := joinrequest.New(
		uuid.New(), uuid.New(),
		addr(),
		"AAAA",
		json.RawMessage(`not-valid-json`),
		peer(), rpc(), "", sig(),
		baseRecord(), launch.LaunchTypeTestnet, time.Now(),
	)
	if err == nil {
		t.Error("expected error: malformed gentx JSON")
	}
}

// --- lifecycle tests ---

func TestApprove(t *testing.T) {
	jr, _ := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	propID := uuid.New()
	if err := jr.Approve(propID); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if jr.Status != joinrequest.StatusApproved {
		t.Errorf("expected APPROVED, got %s", jr.Status)
	}
	if jr.ApprovedByProposal == nil || *jr.ApprovedByProposal != propID {
		t.Error("ApprovedByProposal not set correctly")
	}
}

func TestReject(t *testing.T) {
	jr, _ := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	if err := jr.Reject("bad actor"); err != nil {
		t.Fatalf("Reject: %v", err)
	}
	if jr.Status != joinrequest.StatusRejected {
		t.Errorf("expected REJECTED, got %s", jr.Status)
	}
	if jr.RejectionReason != "bad actor" {
		t.Errorf("unexpected rejection reason: %s", jr.RejectionReason)
	}
}

func TestExpire(t *testing.T) {
	jr, _ := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	if err := jr.Expire(); err != nil {
		t.Fatalf("Expire: %v", err)
	}
	if jr.Status != joinrequest.StatusExpired {
		t.Errorf("expected EXPIRED, got %s", jr.Status)
	}
}

func TestRevoke_FromApproved(t *testing.T) {
	jr, _ := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	_ = jr.Approve(uuid.New())
	if err := jr.Revoke("discovered bad gentx"); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if jr.Status != joinrequest.StatusRejected {
		t.Errorf("expected REJECTED after revoke, got %s", jr.Status)
	}
	if jr.ApprovedByProposal != nil {
		t.Error("ApprovedByProposal should be cleared on revoke")
	}
}

func TestRevoke_CannotRevokePending(t *testing.T) {
	jr, _ := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	if err := jr.Revoke("reason"); err == nil {
		t.Error("expected error: cannot revoke a PENDING request")
	}
}

func TestApprove_CannotApproveTwice(t *testing.T) {
	jr, _ := newJR("testchain-1", 1000000, baseRecord(), launch.LaunchTypeTestnet)
	_ = jr.Approve(uuid.New())
	if err := jr.Approve(uuid.New()); err == nil {
		t.Error("expected error: cannot approve an already-APPROVED request")
	}
}

func TestSelfDelegationAmount(t *testing.T) {
	jr, _ := newJR("testchain-1", 5000000, baseRecord(), launch.LaunchTypeTestnet)
	if got := jr.SelfDelegationAmount(); got != 5000000 {
		t.Errorf("SelfDelegationAmount: got %d, want 5000000", got)
	}
}

// --- commission rate validation tests (spec §2.4) ---

const testSelfDelegation int64 = 1000000

func newJRWithCommission(commRate, maxChangeRate string, record launch.ChainRecord, lt launch.LaunchType) (*joinrequest.JoinRequest, error) {
	return joinrequest.New(
		uuid.New(),
		uuid.New(),
		addr(),
		"AAAA",
		makeGentxWithCommission("testchain-1", testSelfDelegation, commRate, maxChangeRate),
		peer(),
		rpc(),
		"",
		sig(),
		record,
		lt,
		time.Now(),
	)
}

func TestNew_CommissionRate_Mainnet_AtLimit(t *testing.T) {
	_, err := newJRWithCommission("0.20", "0.01", mainnetRecord(), launch.LaunchTypeMainnet)
	if err != nil {
		t.Fatalf("unexpected error at commission limit: %v", err)
	}
}

func TestNew_CommissionRate_Mainnet_ExceedsLimit(t *testing.T) {
	_, err := newJRWithCommission("0.21", "0.01", mainnetRecord(), launch.LaunchTypeMainnet)
	if err == nil {
		t.Error("expected error: commission_rate 0.21 exceeds max 0.20")
	}
}

func TestNew_MaxChangeRate_Mainnet_ExceedsLimit(t *testing.T) {
	_, err := newJRWithCommission("0.10", "0.02", mainnetRecord(), launch.LaunchTypeMainnet)
	if err == nil {
		t.Error("expected error: max_change_rate 0.02 exceeds max 0.01")
	}
}

func TestNew_CommissionRate_Testnet_NotEnforced(t *testing.T) {
	// Testnet should ignore commission limits entirely.
	_, err := newJRWithCommission("0.99", "0.99", mainnetRecord(), launch.LaunchTypeTestnet)
	if err != nil {
		t.Errorf("unexpected error for testnet with high commission: %v", err)
	}
}

func TestNew_CommissionRate_Permissioned_Enforced(t *testing.T) {
	_, err := newJRWithCommission("0.21", "0.01", mainnetRecord(), launch.LaunchTypePermissioned)
	if err == nil {
		t.Error("expected error: commission_rate exceeded for permissioned launch")
	}
}
