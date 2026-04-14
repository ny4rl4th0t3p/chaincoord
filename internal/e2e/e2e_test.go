//go:build e2e

// Package e2e_test contains the end-to-end happy-path test for chaincoord.
// It wires a full in-process server (httptest.NewServer) backed by SQLite :memory:
// and exercises the complete flow from launch creation to block-1 detection.
//
// Run with: go test -tags=e2e ./internal/e2e/...
package e2e_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // required for Cosmos SDK address derivation

	"github.com/cosmos/btcutil/bech32"
	secp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"github.com/google/uuid"

	"github.com/rs/zerolog"

	"github.com/ny4rl4th0t3p/chaincoord/internal/application/services"
	"github.com/ny4rl4th0t3p/chaincoord/internal/domain"
	"github.com/ny4rl4th0t3p/chaincoord/internal/domain/proposal"
	"github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/api"
	"github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/auditlog"
	"github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/auth"
	appCrypto "github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/crypto"
	"github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/jobs"
	"github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/sse"
	fsStore "github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/storage/fs"
	"github.com/ny4rl4th0t3p/chaincoord/internal/infrastructure/storage/sqlite"
	"github.com/ny4rl4th0t3p/chaincoord/internal/netutil"
	"github.com/ny4rl4th0t3p/chaincoord/pkg/canonicaljson"
)

// actor holds a secp256k1 keypair and the bech32 address derived from the pubkey.
type actor struct {
	priv   *secp.PrivateKey
	pub    []byte // compressed 33-byte public key
	pubB64 string
	addr   string
}

// deriveCosmosAddress computes the Cosmos SDK bech32 address for a compressed
// secp256k1 public key: ripemd160(sha256(compressedPubKey))[0:20], encoded with
// the "cosmos" HRP.
func deriveCosmosAddress(compressedPub []byte) string {
	sha := sha256.Sum256(compressedPub)
	ripe := ripemd160.New()
	ripe.Write(sha[:])
	addrBytes := ripe.Sum(nil)
	converted, err := bech32.ConvertBits(addrBytes, 8, 5, true)
	if err != nil {
		panic(fmt.Sprintf("deriveCosmosAddress ConvertBits: %v", err))
	}
	addr, err := bech32.Encode("cosmos", converted)
	if err != nil {
		panic(fmt.Sprintf("deriveCosmosAddress Encode: %v", err))
	}
	return addr
}

// newActor generates a random secp256k1 keypair and derives the corresponding
// Cosmos bech32 address, ensuring the address and key are always consistent.
func newActor(t *testing.T) actor {
	t.Helper()
	priv, err := secp.GeneratePrivateKey()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pub := priv.PubKey().SerializeCompressed()
	return actor{priv: priv, pub: pub, pubB64: base64.StdEncoding.EncodeToString(pub), addr: deriveCosmosAddress(pub)}
}

// sign returns the base64-encoded secp256k1 ECDSA compact signature (r‖s, 64 bytes)
// over sha256(ADR-036 amino bytes of canonical JSON of body), with "signature" and
// "nonce" fields stripped. This matches the ADR-036 verification done by Secp256k1Verifier.
func (a actor) sign(body any) string {
	msg, err := canonicaljson.MarshalForSigning(body)
	if err != nil {
		panic(fmt.Sprintf("MarshalForSigning: %v", err))
	}
	adr036 := appCrypto.BuildADR036AminoBytes(a.addr, msg)
	msgHash := sha256.Sum256(adr036)
	compactSig := ecdsa.SignCompact(a.priv, msgHash[:], true)
	return base64.StdEncoding.EncodeToString(compactSig[1:]) // strip 1-byte recovery flag → 64-byte r‖s
}

func nowTS() string    { return time.Now().UTC().Format(time.RFC3339) }
func newNonce() string { return uuid.New().String() }

// sha256hex returns the lowercase hex SHA256 of data.
func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// ---- HTTP helpers -----------------------------------------------------------

type testClient struct {
	base  string
	token string
	http  *http.Client
}

func newClient(base string) *testClient {
	return &testClient{base: base, http: &http.Client{}}
}

func (c *testClient) withToken(token string) *testClient {
	return &testClient{base: c.base, token: token, http: c.http}
}

func (c *testClient) do(method, path string, body any) *http.Response {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(err)
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, r)
	if err != nil {
		panic(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		panic(err)
	}
	return resp
}

func (c *testClient) doRaw(method, path string, contentType string, body []byte) *http.Response {
	req, err := http.NewRequest(method, c.base+path, bytes.NewReader(body))
	if err != nil {
		panic(err)
	}
	req.Header.Set("Content-Type", contentType)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		panic(err)
	}
	return resp
}

func mustDecode(t *testing.T, resp *http.Response, want int, dst any) {
	t.Helper()
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		t.Fatalf("HTTP %s: want %d, got %d — body: %s", resp.Request.URL.Path, want, resp.StatusCode, b)
	}
	if dst != nil {
		if err := json.Unmarshal(b, dst); err != nil {
			t.Fatalf("decode response: %v — body: %s", err, b)
		}
	}
}

// ---- auth helpers -----------------------------------------------------------

// authenticate runs the challenge-response flow and returns a session token.
func authenticate(t *testing.T, c *testClient, a actor) string {
	t.Helper()

	// Step 1: get challenge
	var chalResp struct {
		Challenge string `json:"challenge"`
	}
	mustDecode(t, c.do("POST", "/auth/challenge", map[string]string{
		"operator_address": a.addr,
	}), http.StatusOK, &chalResp)

	// Step 2: sign and verify
	input := services.VerifyChallengeInput{
		OperatorAddress: a.addr,
		PubKeyB64:       a.pubB64,
		Challenge:       chalResp.Challenge,
		Nonce:           newNonce(),
		Timestamp:       nowTS(),
	}
	input.Signature = a.sign(input)

	var verifyResp struct {
		Token string `json:"token"`
	}
	mustDecode(t, c.do("POST", "/auth/verify", input), http.StatusOK, &verifyResp)
	return verifyResp.Token
}

// ---- proposal helpers -------------------------------------------------------

// raiseProposal raises a proposal and asserts it executed (1-of-1 committee).
func raiseProposal(t *testing.T, c *testClient, launchID string, coord actor, actionType proposal.ActionType, payload any) string {
	t.Helper()

	payloadBytes, _ := json.Marshal(payload)
	input := services.RaiseInput{
		ActionType:      actionType,
		Payload:         json.RawMessage(payloadBytes),
		CoordinatorAddr: coord.addr,
		Nonce:           newNonce(),
		Timestamp:       nowTS(),
	}
	input.Signature = coord.sign(input)

	var resp struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	mustDecode(t, c.do("POST", "/launch/"+launchID+"/proposal", input), http.StatusCreated, &resp)
	if resp.Status != "EXECUTED" {
		t.Fatalf("proposal %s for action %s: want EXECUTED, got %s", resp.ID, actionType, resp.Status)
	}
	return resp.ID
}

// ---- test server wiring -----------------------------------------------------

type testServer struct {
	ts         *httptest.Server
	launchRepo *sqlite.LaunchRepository
	client     *testClient
}

func startServer(t *testing.T) *testServer {
	t.Helper()

	db, err := sqlite.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	dir := t.TempDir()
	genesisStore, err := fsStore.NewGenesisStore(filepath.Join(dir, "genesis"))
	if err != nil {
		t.Fatalf("genesis store: %v", err)
	}
	al, err := auditlog.Open(filepath.Join(dir, "audit.jsonl"), nil)
	if err != nil {
		t.Fatalf("auditlog: %v", err)
	}
	t.Cleanup(func() { al.Close() })

	sseBroker := sse.New()
	verifier := appCrypto.NewSecp256k1Verifier()
	tx := sqlite.NewTransactor(db)

	launchRepo := sqlite.NewLaunchRepository(db)
	joinReqRepo := sqlite.NewJoinRequestRepository(db)
	proposalRepo := sqlite.NewProposalRepository(db)
	readinessRepo := sqlite.NewReadinessRepository(db)
	// Use a fixed test key (32 zero bytes, base64-encoded) — safe for e2e tests only.
	const e2eJWTKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	sessionStore, err := auth.NewJWTSessionStore(e2eJWTKey, db)
	if err != nil {
		t.Fatalf("jwt session store: %v", err)
	}
	challengeStore := sqlite.NewChallengeStore(db)
	nonceStore := sqlite.NewNonceStore(db)
	allowlistRepo := sqlite.NewCoordinatorAllowlistRepo(db)

	authSvc := services.NewAuthService(challengeStore, sessionStore, nonceStore, verifier)
	launchSvc := services.NewLaunchService(launchRepo, joinReqRepo, readinessRepo, genesisStore, sseBroker, al).
		WithURLValidator(netutil.ValidateRPCURLFormat)
	joinReqSvc := services.NewJoinRequestService(launchRepo, joinReqRepo, nonceStore, verifier)
	proposalSvc := services.NewProposalService(
		launchRepo, joinReqRepo, proposalRepo, readinessRepo,
		nonceStore, verifier, sseBroker, al, tx,
	)
	readinessSvc := services.NewReadinessService(launchRepo, joinReqRepo, readinessRepo, nonceStore, verifier)

	apiServer := api.NewServer(
		zerolog.Nop(), "", nil,
		authSvc, launchSvc, joinReqSvc, proposalSvc, readinessSvc,
		sessionStore, sseBroker, genesisStore, al,
		al.PubKey(), allowlistRepo, "open", true, 64<<20,
	)

	ts := httptest.NewServer(apiServer.Handler())
	t.Cleanup(ts.Close)

	return &testServer{
		ts:         ts,
		launchRepo: launchRepo,
		client:     newClient(ts.URL),
	}
}

// setWindowOpen loads the launch from the repo, sets status to WINDOW_OPEN,

// ---- The test ---------------------------------------------------------------

func TestE2E_HappyPath(t *testing.T) {
	// 1. Generate keypairs.
	coord := newActor(t)
	val1 := newActor(t)
	val2 := newActor(t)
	val3 := newActor(t)
	val4 := newActor(t)

	// 2. Start test server.
	srv := startServer(t)
	c := srv.client

	// 3. Coordinator auth.
	coordToken := authenticate(t, c, coord)
	coordClient := c.withToken(coordToken)

	// 4. Create launch (1-of-1 committee, min_validator_count=2).
	maxCommRate := "0.20"
	maxCommChange := "0.01"
	gentxDeadline := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	windowOpen := time.Now().UTC().Format(time.RFC3339)

	launchBody := map[string]any{
		"record": map[string]any{
			"chain_id":                   "testchain-1",
			"chain_name":                 "Test Chain",
			"binary_name":                "testchaind",
			"binary_version":             "v1.0.0",
			"binary_sha256":              "abc123",
			"denom":                      "utest",
			"min_self_delegation":        "1000000",
			"max_commission_rate":        maxCommRate,
			"max_commission_change_rate": maxCommChange,
			"gentx_deadline":             gentxDeadline,
			"application_window_open":    windowOpen,
			"min_validator_count":        4,
		},
		"launch_type": "TESTNET",
		"visibility":  "PUBLIC",
		"committee": map[string]any{
			"members": []map[string]any{
				{
					"address":     coord.addr,
					"moniker":     "coordinator",
					"pub_key_b64": coord.pubB64,
				},
			},
			"threshold_m":        1,
			"total_n":            1,
			"lead_address":       coord.addr,
			"creation_signature": base64.StdEncoding.EncodeToString(make([]byte, 64)),
		},
	}

	var launchResp struct {
		ID string `json:"id"`
	}
	mustDecode(t, coordClient.do("POST", "/launch", launchBody), http.StatusCreated, &launchResp)
	launchID := launchResp.ID
	if launchID == "" {
		t.Fatal("no launch ID in response")
	}

	var launchGet struct {
		Status string `json:"status"`
	}

	// 5. Upload initial genesis, then raise PUBLISH_CHAIN_RECORD proposal (§1.2/§1.3).
	// The 1-of-1 committee means the proposal auto-executes on raise.
	initialGenesis := []byte(`{"chain_id":"testchain-1"}`)
	initialGenesisHash := sha256hex(initialGenesis)

	var initialGenesisResp struct {
		SHA256 string `json:"sha256"`
	}
	mustDecode(t,
		coordClient.doRaw("POST", "/launch/"+launchID+"/genesis?type=initial", "application/octet-stream", initialGenesis),
		http.StatusOK, &initialGenesisResp)
	if initialGenesisResp.SHA256 != initialGenesisHash {
		t.Fatalf("initial genesis SHA256 mismatch: got %s, want %s", initialGenesisResp.SHA256, initialGenesisHash)
	}

	raiseProposal(t, coordClient, launchID, coord, proposal.ActionPublishChainRecord,
		proposal.PublishChainRecordPayload{InitialGenesisHash: initialGenesisHash})

	mustDecode(t, c.do("GET", "/launch/"+launchID, nil), http.StatusOK, &launchGet)
	if launchGet.Status != "PUBLISHED" {
		t.Fatalf("want PUBLISHED after publish-chain-record proposal, got %s", launchGet.Status)
	}

	// Open the application window (direct coordinator action — no proposal required).
	mustDecode(t, coordClient.do("POST", "/launch/"+launchID+"/open-window", nil), http.StatusOK, &launchGet)
	if launchGet.Status != "WINDOW_OPEN" {
		t.Fatalf("want WINDOW_OPEN after open-window, got %s", launchGet.Status)
	}

	// 6. Validator 1 auth + join.
	val1Token := authenticate(t, c, val1)
	val1Client := c.withToken(val1Token)

	gentx := json.RawMessage(fmt.Sprintf(`{"chain_id":"testchain-1","body":{"messages":[{"@type":"/cosmos.staking.v1beta1.MsgCreateValidator","value":{"amount":"2000000utest"}}]}}` + ``))
	joinInput1 := services.SubmitInput{
		ChainID:         "testchain-1",
		OperatorAddress: val1.addr,
		PubKeyB64:       val1.pubB64,
		ConsensusPubKey: val1.pubB64, // reuse operator key as consensus key for simplicity
		GentxJSON:       gentx,
		PeerAddress:     "abcdef1234567890abcdef1234567890abcdef12@192.168.1.1:26656",
		RPCEndpoint:     "https://192.168.1.1:26657",
		Memo:            "val1",
		Nonce:           newNonce(),
		Timestamp:       nowTS(),
	}
	joinInput1.Signature = val1.sign(joinInput1)

	var joinResp1 struct {
		ID string `json:"id"`
	}
	mustDecode(t, val1Client.do("POST", "/launch/"+launchID+"/join", joinInput1), http.StatusCreated, &joinResp1)
	jr1ID := joinResp1.ID

	// 7. Validator 2 auth + join.
	val2Token := authenticate(t, c, val2)
	val2Client := c.withToken(val2Token)

	joinInput2 := services.SubmitInput{
		ChainID:         "testchain-1",
		OperatorAddress: val2.addr,
		PubKeyB64:       val2.pubB64,
		ConsensusPubKey: val2.pubB64,
		GentxJSON:       gentx,
		PeerAddress:     "abcdef1234567890abcdef1234567890abcdef12@192.168.1.2:26656",
		RPCEndpoint:     "https://192.168.1.2:26657",
		Memo:            "val2",
		Nonce:           newNonce(),
		Timestamp:       nowTS(),
	}
	joinInput2.Signature = val2.sign(joinInput2)

	var joinResp2 struct {
		ID string `json:"id"`
	}
	mustDecode(t, val2Client.do("POST", "/launch/"+launchID+"/join", joinInput2), http.StatusCreated, &joinResp2)
	jr2ID := joinResp2.ID

	// 7b. Validator 3 auth + join.
	val3Token := authenticate(t, c, val3)
	val3Client := c.withToken(val3Token)

	joinInput3 := services.SubmitInput{
		ChainID:         "testchain-1",
		OperatorAddress: val3.addr,
		PubKeyB64:       val3.pubB64,
		ConsensusPubKey: val3.pubB64,
		GentxJSON:       gentx,
		PeerAddress:     "abcdef1234567890abcdef1234567890abcdef12@192.168.1.3:26656",
		RPCEndpoint:     "https://192.168.1.3:26657",
		Memo:            "val3",
		Nonce:           newNonce(),
		Timestamp:       nowTS(),
	}
	joinInput3.Signature = val3.sign(joinInput3)

	var joinResp3 struct {
		ID string `json:"id"`
	}
	mustDecode(t, val3Client.do("POST", "/launch/"+launchID+"/join", joinInput3), http.StatusCreated, &joinResp3)
	jr3ID := joinResp3.ID

	// 7c. Validator 4 auth + join.
	val4Token := authenticate(t, c, val4)
	val4Client := c.withToken(val4Token)

	joinInput4 := services.SubmitInput{
		ChainID:         "testchain-1",
		OperatorAddress: val4.addr,
		PubKeyB64:       val4.pubB64,
		ConsensusPubKey: val4.pubB64,
		GentxJSON:       gentx,
		PeerAddress:     "abcdef1234567890abcdef1234567890abcdef12@192.168.1.4:26656",
		RPCEndpoint:     "https://192.168.1.4:26657",
		Memo:            "val4",
		Nonce:           newNonce(),
		Timestamp:       nowTS(),
	}
	joinInput4.Signature = val4.sign(joinInput4)

	var joinResp4 struct {
		ID string `json:"id"`
	}
	mustDecode(t, val4Client.do("POST", "/launch/"+launchID+"/join", joinInput4), http.StatusCreated, &joinResp4)
	jr4ID := joinResp4.ID

	// 8. Coordinator approves validator 1 (1-of-1 → auto-executes).
	raiseProposal(t, coordClient, launchID, coord, proposal.ActionApproveValidator,
		proposal.ApproveValidatorPayload{
			JoinRequestID:   uuid.MustParse(jr1ID),
			OperatorAddress: val1.addr,
		})

	// 9. Coordinator approves validators 2, 3, 4.
	raiseProposal(t, coordClient, launchID, coord, proposal.ActionApproveValidator,
		proposal.ApproveValidatorPayload{
			JoinRequestID:   uuid.MustParse(jr2ID),
			OperatorAddress: val2.addr,
		})
	raiseProposal(t, coordClient, launchID, coord, proposal.ActionApproveValidator,
		proposal.ApproveValidatorPayload{
			JoinRequestID:   uuid.MustParse(jr3ID),
			OperatorAddress: val3.addr,
		})
	raiseProposal(t, coordClient, launchID, coord, proposal.ActionApproveValidator,
		proposal.ApproveValidatorPayload{
			JoinRequestID:   uuid.MustParse(jr4ID),
			OperatorAddress: val4.addr,
		})

	// 10. Coordinator closes the application window (4 approved → min_validator_count=4 ✓, each holds 25% < 1/3 ✓).
	raiseProposal(t, coordClient, launchID, coord, proposal.ActionCloseApplicationWindow,
		proposal.CloseApplicationWindowPayload{})

	// Verify launch is now WINDOW_CLOSED.
	mustDecode(t, c.do("GET", "/launch/"+launchID, nil), http.StatusOK, &launchGet)
	if launchGet.Status != "WINDOW_CLOSED" {
		t.Fatalf("want WINDOW_CLOSED after close-window proposal, got %s", launchGet.Status)
	}

	// 11. Upload final genesis (requires WINDOW_CLOSED).
	// Build the final genesis dynamically so gen_txs matches the 4 approved validators.
	// validateFinalGenesis checks that every approved validator's consensus pubkey
	// appears exactly once in app_state.genutil.gen_txs.
	genTxFor := func(pubKeyB64 string) map[string]any {
		return map[string]any{
			"body": map[string]any{
				"messages": []map[string]any{
					{"pubkey": map[string]any{"key": pubKeyB64}},
				},
			},
		}
	}
	finalGenesisData := map[string]any{
		"chain_id":     "testchain-1",
		"genesis_time": "2026-06-01T00:00:00Z",
		"app_state": map[string]any{
			"genutil": map[string]any{
				"gen_txs": []any{
					genTxFor(val1.pubB64),
					genTxFor(val2.pubB64),
					genTxFor(val3.pubB64),
					genTxFor(val4.pubB64),
				},
			},
		},
	}
	finalGenesis, err := json.Marshal(finalGenesisData)
	if err != nil {
		t.Fatalf("marshal final genesis: %v", err)
	}
	finalGenesisHash := sha256hex(finalGenesis)

	var genesisUploadResp struct {
		SHA256 string `json:"sha256"`
	}
	mustDecode(t,
		coordClient.doRaw("POST", "/launch/"+launchID+"/genesis?type=final", "application/octet-stream", finalGenesis),
		http.StatusOK, &genesisUploadResp)
	if genesisUploadResp.SHA256 != finalGenesisHash {
		t.Fatalf("genesis SHA256 mismatch: got %s, want %s", genesisUploadResp.SHA256, finalGenesisHash)
	}

	// 12. Coordinator raises PUBLISH_GENESIS → GENESIS_READY.
	raiseProposal(t, coordClient, launchID, coord, proposal.ActionPublishGenesis,
		proposal.PublishGenesisPayload{GenesisHash: finalGenesisHash})

	mustDecode(t, c.do("GET", "/launch/"+launchID, nil), http.StatusOK, &launchGet)
	if launchGet.Status != "GENESIS_READY" {
		t.Fatalf("want GENESIS_READY after publish-genesis proposal, got %s", launchGet.Status)
	}

	// 13. All validators confirm readiness.
	confirmReadiness(t, val1Client, launchID, val1, finalGenesisHash, "abc123")
	confirmReadiness(t, val2Client, launchID, val2, finalGenesisHash, "abc123")
	confirmReadiness(t, val3Client, launchID, val3, finalGenesisHash, "abc123")
	confirmReadiness(t, val4Client, launchID, val4, finalGenesisHash, "abc123")

	// 15. Start mock CometBFT RPC that responds to GET /block?height=1.
	mockRPC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.RawQuery, "height=1") {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"result":{"block":{"header":{"height":"1"}}}}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer mockRPC.Close()

	// 16. PATCH monitor_rpc_url on the launch.
	mustDecode(t,
		coordClient.do("PATCH", "/launch/"+launchID, map[string]string{
			"monitor_rpc_url": mockRPC.URL,
		}),
		http.StatusOK, nil)

	// 17. Start RunLaunchMonitor with a 50ms interval.
	monCtx, stopMon := context.WithCancel(context.Background())
	defer stopMon()
	go jobs.RunLaunchMonitor(monCtx, srv.launchRepo, noopPublisher{}, zerolog.Nop(), 50*time.Millisecond, nil)

	// 18. Poll GET /launch/:id until status=LAUNCHED (2s timeout).
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mustDecode(t, c.do("GET", "/launch/"+launchID, nil), http.StatusOK, &launchGet)
		if launchGet.Status == "LAUNCHED" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if launchGet.Status != "LAUNCHED" {
		t.Fatalf("launch never reached LAUNCHED status (last: %s)", launchGet.Status)
	}

	t.Logf("E2E happy path complete: launch %s reached LAUNCHED", launchID)
}

// confirmReadiness submits a readiness confirmation for a validator.
func confirmReadiness(t *testing.T, c *testClient, launchID string, v actor, genesisHash, binaryHash string) {
	t.Helper()
	input := services.ConfirmInput{
		OperatorAddress:      v.addr,
		PubKeyB64:            v.pubB64,
		GenesisHashConfirmed: genesisHash,
		BinaryHashConfirmed:  binaryHash,
		Nonce:                newNonce(),
		Timestamp:            nowTS(),
	}
	input.Signature = v.sign(input)
	mustDecode(t, c.do("POST", "/launch/"+launchID+"/ready", input), http.StatusCreated, nil)
}

// noopPublisher satisfies the jobs.eventPublisher interface without doing anything.
// The monitor only needs the launch repo and the publisher for the LaunchDetected event.
type noopPublisher struct{}

func (noopPublisher) Publish(_ domain.DomainEvent) {}
