// TypeScript types mirroring the Go JSON wire shapes.
// Keep in sync with internal/infrastructure/api/*.go

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PageEnvelope<T> {
  items: T;
  total: number;
  page: number;
  per_page: number;
}

// ── Launch ────────────────────────────────────────────────────────────────────

export interface ChainRecord {
  chain_id: string;
  chain_name: string;
  bech32_prefix: string;
  binary_name: string;
  binary_version: string;
  binary_sha256: string;
  repo_url: string;
  repo_commit: string;
  genesis_time?: string;
  denom: string;
  min_self_delegation: string;
  max_commission_rate: string;
  max_commission_change_rate: string;
  gentx_deadline: string;
  application_window_open: string;
  min_validator_count: number;
}

export type LaunchStatus =
  | 'draft'
  | 'open'
  | 'window_closed'
  | 'genesis_ready'
  | 'launched'
  | 'canceled';

export type LaunchType = 'mainnet' | 'testnet' | 'devnet';
export type Visibility = 'public' | 'allowlist';

export interface Launch {
  id: string;
  record: ChainRecord;
  launch_type: LaunchType;
  visibility: Visibility;
  status: LaunchStatus;
  initial_genesis_sha256?: string;
  final_genesis_sha256?: string;
  monitor_rpc_url?: string;
  created_at: string;
  updated_at: string;
}

// ── Committee ─────────────────────────────────────────────────────────────────

export interface CommitteeMember {
  address: string;
  moniker: string;
  pub_key_b64: string;
}

export interface Committee {
  id: string;
  members: CommitteeMember[];
  threshold_m: number;
  total_n: number;
  lead_address: string;
  creation_signature: string;
  created_at: string;
}

// ── Join Request ──────────────────────────────────────────────────────────────

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface JoinRequest {
  id: string;
  launch_id: string;
  operator_address: string;
  consensus_pubkey: string;
  gentx: unknown;
  peer_address: string;
  rpc_endpoint: string;
  memo: string;
  submitted_at: string;
  status: JoinRequestStatus;
  rejection_reason?: string;
  approved_by_proposal?: string;
}

// ── Proposal ──────────────────────────────────────────────────────────────────

export type ProposalStatus = 'pending' | 'executed' | 'expired' | 'vetoed';
export type Decision = 'sign' | 'veto';

export interface SignatureEntry {
  coordinator_address: string;
  decision: Decision;
  timestamp: string;
}

export interface Proposal {
  id: string;
  launch_id: string;
  action_type: string;
  payload: unknown;
  proposed_by: string;
  proposed_at: string;
  ttl_expires: string;
  status: ProposalStatus;
  executed_at?: string;
  signatures: SignatureEntry[];
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface ValidatorReadiness {
  join_request_id: string;
  operator_address: string;
  moniker: string;
  voting_power_pct: number;
  is_ready: boolean;
  last_confirmed_at?: string;
  genesis_hash_confirmed?: string;
  binary_hash_confirmed?: string;
}

export interface Dashboard {
  launch_id: string;
  chain_id: string;
  status: string;
  genesis_time?: string;
  final_genesis_sha256?: string;
  total_approved: number;
  confirmed_ready: number;
  voting_power_confirmed: number;
  threshold_status: string;
  validators: ValidatorReadiness[];
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  launch_id: string;
  event_name: string;
  occurred_at: string;
  payload: unknown;
  signature: string;
}

// ── Error envelope ────────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
}
