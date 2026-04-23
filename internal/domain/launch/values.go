package launch

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/cosmos/btcutil/bech32"
)

const (
	sha256HexLen    = 64 // hex-encoded SHA-256 digest length in characters
	secp256k1SigLen = 64 // secp256k1 compact signature length in bytes
)

// OperatorAddress is a validated bech32 Cosmos SDK operator address.
// Accepts any bech32 prefix — the system is Cosmos SDK-compatible but not
// tied to a single chain's prefix (e.g. "cosmos1...", "osmo1...", etc.).
type OperatorAddress struct {
	value string
}

func NewOperatorAddress(s string) (OperatorAddress, error) {
	if s == "" {
		return OperatorAddress{}, fmt.Errorf("operator address: empty")
	}
	// Decode validates the checksum, HRP, and base32 data encoding.
	// The limit of 1023 is the maximum bech32 length per BIP-0173; Cosmos addresses
	// are always well under this.
	hrp, _, err := bech32.Decode(s, 1023)
	if err != nil {
		return OperatorAddress{}, fmt.Errorf("operator address: invalid bech32 %q: %w", s, err)
	}
	if hrp == "" {
		return OperatorAddress{}, fmt.Errorf("operator address: missing human-readable prefix in %q", s)
	}
	return OperatorAddress{value: s}, nil
}

func (a OperatorAddress) String() string { return a.value }
func (a OperatorAddress) Equal(other OperatorAddress) bool {
	return a.value == other.value
}

// MustNewOperatorAddress creates an OperatorAddress and panics if invalid.
// Use only in tests and package-level initialisers.
func MustNewOperatorAddress(s string) OperatorAddress {
	a, err := NewOperatorAddress(s)
	if err != nil {
		panic(err)
	}
	return a
}

// GenesisHash is a validated SHA256 hash in lowercase hex.
type GenesisHash struct {
	value string
}

func NewGenesisHash(s string) (GenesisHash, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) != sha256HexLen {
		return GenesisHash{}, fmt.Errorf("genesis hash: must be 64 hex chars, got %d", len(s))
	}
	if _, err := hex.DecodeString(s); err != nil {
		return GenesisHash{}, fmt.Errorf("genesis hash: not valid hex: %w", err)
	}
	return GenesisHash{value: s}, nil
}

func (h GenesisHash) String() string { return h.value }
func (h GenesisHash) Equal(other GenesisHash) bool {
	return h.value == other.value
}

var nodeIDPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)

// PeerAddress is a validated <node_id>@<ip>:<port> address.
type PeerAddress struct {
	value string
}

func NewPeerAddress(s string) (PeerAddress, error) {
	parts := strings.SplitN(s, "@", 2)
	if len(parts) != 2 {
		return PeerAddress{}, fmt.Errorf("peer address: must be <node_id>@<host>:<port>, got %q", s)
	}
	nodeID, hostPort := parts[0], parts[1]
	if !nodeIDPattern.MatchString(nodeID) {
		return PeerAddress{}, fmt.Errorf("peer address: node_id must be 40 hex chars, got %q", nodeID)
	}
	host, portStr, err := net.SplitHostPort(hostPort)
	if err != nil {
		return PeerAddress{}, fmt.Errorf("peer address: invalid host:port %q: %w", hostPort, err)
	}
	if host == "" {
		return PeerAddress{}, fmt.Errorf("peer address: host is empty")
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return PeerAddress{}, fmt.Errorf("peer address: invalid port %q", portStr)
	}
	return PeerAddress{value: s}, nil
}

func (p PeerAddress) String() string { return p.value }

// RPCEndpoint is a validated https URL for a node's RPC interface.
type RPCEndpoint struct {
	value string
}

func NewRPCEndpoint(s string) (RPCEndpoint, error) {
	if s == "" {
		return RPCEndpoint{}, fmt.Errorf("rpc endpoint: empty")
	}
	u, err := url.ParseRequestURI(s)
	if err != nil {
		return RPCEndpoint{}, fmt.Errorf("rpc endpoint: invalid URL %q: %w", s, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return RPCEndpoint{}, fmt.Errorf("rpc endpoint: scheme must be http or https, got %q", u.Scheme)
	}
	if u.Host == "" {
		return RPCEndpoint{}, fmt.Errorf("rpc endpoint: missing host")
	}
	return RPCEndpoint{value: s}, nil
}

func (r RPCEndpoint) String() string { return r.value }

// Signature is a base64-encoded secp256k1 compact signature (r‖s, 64 bytes).
type Signature struct {
	value string
}

func NewSignature(s string) (Signature, error) {
	if s == "" {
		return Signature{}, fmt.Errorf("signature: empty")
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return Signature{}, fmt.Errorf("signature: not valid base64: %w", err)
	}
	if len(b) != secp256k1SigLen {
		return Signature{}, fmt.Errorf("signature: secp256k1 compact signature must be 64 bytes, got %d", len(b))
	}
	return Signature{value: s}, nil
}

func (s Signature) String() string { return s.value }

// CommissionRate is a validated decimal in the range [0.00, 1.00].
type CommissionRate struct {
	value string // stored as string to preserve precision
	f     float64
}

func NewCommissionRate(s string) (CommissionRate, error) {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return CommissionRate{}, fmt.Errorf("commission rate: not a valid decimal %q: %w", s, err)
	}
	if f < 0 || f > 1 {
		return CommissionRate{}, fmt.Errorf("commission rate: must be between 0.00 and 1.00, got %v", f)
	}
	return CommissionRate{value: s, f: f}, nil
}

func (c CommissionRate) String() string   { return c.value }
func (c CommissionRate) Float64() float64 { return c.f }
func (c CommissionRate) LessThanOrEqual(other CommissionRate) bool {
	return c.f <= other.f
}

// Allowlist is an immutable set of OperatorAddresses.
// The zero value is an empty (open) allowlist.
type Allowlist struct {
	members map[string]struct{}
}

func NewAllowlist(addresses []OperatorAddress) Allowlist {
	m := make(map[string]struct{}, len(addresses))
	for _, a := range addresses {
		m[a.String()] = struct{}{}
	}
	return Allowlist{members: m}
}

func (al Allowlist) Contains(addr OperatorAddress) bool {
	_, ok := al.members[addr.String()]
	return ok
}

func (al Allowlist) Add(addr OperatorAddress) Allowlist {
	m := make(map[string]struct{}, len(al.members)+1)
	for k := range al.members {
		m[k] = struct{}{}
	}
	m[addr.String()] = struct{}{}
	return Allowlist{members: m}
}

func (al Allowlist) Remove(addr OperatorAddress) Allowlist {
	m := make(map[string]struct{}, len(al.members))
	for k := range al.members {
		m[k] = struct{}{}
	}
	delete(m, addr.String())
	return Allowlist{members: m}
}

func (al Allowlist) Addresses() []OperatorAddress {
	out := make([]OperatorAddress, 0, len(al.members))
	for k := range al.members {
		out = append(out, OperatorAddress{value: k})
	}
	// Sort for deterministic output — callers must not depend on insertion order.
	sort.Slice(out, func(i, j int) bool { return out[i].value < out[j].value })
	return out
}

func (al Allowlist) Len() int { return len(al.members) }
