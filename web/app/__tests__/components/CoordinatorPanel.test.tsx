import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CoordinatorPanel } from '@/components/CoordinatorPanel';
import { buildSignedAction } from '@/utils/signedAction';
import type { Committee, JoinRequest, Launch, Proposal } from '@/types';

// ── ESM shims ────────────────────────────────────────────────────────────────

jest.mock('@interchain-kit/core', () => ({ CosmosWallet: class CosmosWallet {} }));
jest.mock('@interchain-kit/react/store/stateful-wallet', () => ({
  StatefulWallet: class StatefulWallet {},
}));

jest.mock('@interchain-ui/react', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock('@/components', () => ({
  Button: ({
    children,
    onClick,
    isLoading,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    isLoading?: boolean;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled ?? isLoading}>
      {children}
    </button>
  ),
}));

jest.mock('@/utils/signedAction', () => ({
  buildSignedAction: jest.fn(),
}));

const mockSign = buildSignedAction as jest.MockedFunction<typeof buildSignedAction>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LAUNCH_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROP_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const JR_ID = 'cccccccc-0000-0000-0000-000000000003';

const HINT = {
  chain_id: 'mychain-1',
  chain_name: 'mychain',
  bech32_prefix: 'cosmos',
  denom: 'uatom',
};
const ADDRESS = 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu';
const MOCK_WALLET = {} as any;

const BASE_RECORD = {
  chain_id: 'mychain-1',
  chain_name: 'mychain',
  bech32_prefix: 'cosmos',
  binary_name: 'gaiad',
  binary_version: 'v15.0.0',
  binary_sha256: 'abc123',
  repo_url: '',
  repo_commit: '',
  denom: 'uatom',
  min_self_delegation: '1',
  max_commission_rate: '0.2',
  max_commission_change_rate: '0.01',
  gentx_deadline: '2026-06-01T00:00:00Z',
  application_window_open: '2026-05-01T00:00:00Z',
  min_validator_count: 4,
};

function makeLaunch(overrides?: Partial<Launch>): Launch {
  return {
    id: LAUNCH_ID,
    record: BASE_RECORD,
    launch_type: 'testnet',
    visibility: 'public',
    status: 'open',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeJoinRequest(overrides?: Partial<JoinRequest>): JoinRequest {
  return {
    id: JR_ID,
    launch_id: LAUNCH_ID,
    operator_address: 'cosmos1validator000000000000000000000000000000',
    consensus_pubkey: 'cosmosvalconspub1testkey',
    gentx: {},
    peer_address: '1.2.3.4:26656',
    rpc_endpoint: '',
    memo: 'my node',
    submitted_at: '2026-05-01T00:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

function makeCommittee(overrides?: Partial<Committee>): Committee {
  return {
    id: 'dddddddd-0000-0000-0000-000000000004',
    members: [{ address: ADDRESS, moniker: 'lead', pub_key_b64: 'testpubkey==' }],
    threshold_m: 1,
    total_n: 1,
    lead_address: ADDRESS,
    creation_signature: 'testsig==',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeProposal(overrides?: Partial<Proposal>): Proposal {
  return {
    id: PROP_ID,
    launch_id: LAUNCH_ID,
    action_type: 'APPROVE_VALIDATOR',
    payload: { join_request_id: JR_ID, operator_address: ADDRESS },
    proposed_by: ADDRESS,
    proposed_at: '2026-05-01T00:00:00Z',
    ttl_expires: '2026-05-08T00:00:00Z',
    status: 'pending',
    signatures: [],
    ...overrides,
  };
}

// Default authFetch: returns empty lists for join + proposals, no-op for mutations.
function makeAuthFetch(overrides?: {
  joinItems?: JoinRequest[];
  proposalItems?: Proposal[];
  mutationResponse?: object;
}) {
  return jest.fn().mockImplementation(async (url: string) => {
    if (url.includes('/join')) {
      return { ok: true, json: async () => ({ items: overrides?.joinItems ?? [] }) };
    }
    if (url.includes('/proposals')) {
      return { ok: true, json: async () => ({ items: overrides?.proposalItems ?? [] }) };
    }
    return { ok: true, json: async () => overrides?.mutationResponse ?? {} };
  });
}

function defaultProps(overrides?: {
  launch?: Partial<Launch>;
  committee?: Partial<Committee>;
  authFetch?: jest.Mock;
  onLaunchUpdated?: jest.Mock;
  onCommitteeUpdated?: jest.Mock;
  isLead?: boolean;
}) {
  return {
    launchId: LAUNCH_ID,
    hint: HINT,
    address: ADDRESS,
    wallet: MOCK_WALLET,
    signingChainId: HINT.chain_id,
    launch: makeLaunch(overrides?.launch),
    committee: makeCommittee(overrides?.committee),
    isLead: overrides?.isLead ?? true,
    authFetch: overrides?.authFetch ?? makeAuthFetch(),
    onLaunchUpdated: overrides?.onLaunchUpdated ?? jest.fn(),
    onCommitteeUpdated: overrides?.onCommitteeUpdated ?? jest.fn(),
  };
}

function mockSignedResult() {
  mockSign.mockImplementation(async (payload: Record<string, unknown>) => ({
    ...payload,
    timestamp: '2026-01-01T00:00:00Z',
    nonce: 'test-nonce',
    pubkey_b64: 'testpubkey==',
    signature: 'testsig==',
  }) as any);
}

// ── H.7 — Join queue ──────────────────────────────────────────────────────────

describe('CoordinatorPanel — JoinQueueSection (H.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedResult();
  });

  it('shows empty state when no join requests', async () => {
    render(<CoordinatorPanel {...defaultProps()} />);
    await waitFor(() => {
      expect(screen.getByText(/No join requests yet/)).toBeInTheDocument();
    });
  });

  it('renders operator address and memo for each request', async () => {
    const jr = makeJoinRequest({ memo: 'fast-node' });
    const authFetch = makeAuthFetch({ joinItems: [jr] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.getByText(/fast-node/)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(jr.operator_address.slice(0, 12)))).toBeInTheDocument();
    });
  });

  it('shows Approve and Reject buttons for pending requests', async () => {
    const authFetch = makeAuthFetch({ joinItems: [makeJoinRequest({ status: 'pending' })] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });
  });

  it('shows no action buttons for approved requests', async () => {
    const authFetch = makeAuthFetch({ joinItems: [makeJoinRequest({ status: 'approved' })] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });
  });

  it('shows fetch error when join queue request fails', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) {
        return { ok: false, status: 500, json: async () => ({ message: 'internal error' }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.getByText('internal error')).toBeInTheDocument();
    });
  });
});

// ── H.8 — Raise proposal ──────────────────────────────────────────────────────

describe('CoordinatorPanel — ProposalForm (H.8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedResult();
  });

  async function openApproveForm(authFetch: jest.Mock) {
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Approve' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    });
  }

  async function openRejectForm(authFetch: jest.Mock) {
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Reject' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    });
  }

  it('opens APPROVE_VALIDATOR form when Approve is clicked', async () => {
    const authFetch = makeAuthFetch({ joinItems: [makeJoinRequest()] });
    await openApproveForm(authFetch);
    expect(screen.getByText('Approve Validator')).toBeInTheDocument();
  });

  it('opens REJECT_VALIDATOR form when Reject is clicked', async () => {
    const authFetch = makeAuthFetch({ joinItems: [makeJoinRequest()] });
    await openRejectForm(authFetch);
    expect(screen.getByText('Reject Validator')).toBeInTheDocument();
  });

  it('shows reason field for REJECT but not for APPROVE', async () => {
    const authFetchApprove = makeAuthFetch({ joinItems: [makeJoinRequest()] });
    const { unmount } = render(<CoordinatorPanel {...defaultProps({ authFetch: authFetchApprove })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Approve' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
    expect(screen.queryByPlaceholderText(/Reason for rejection/)).not.toBeInTheDocument();
    unmount();

    const authFetchReject = makeAuthFetch({ joinItems: [makeJoinRequest()] });
    render(<CoordinatorPanel {...defaultProps({ authFetch: authFetchReject })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Reject' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reject' })); });
    expect(screen.getByPlaceholderText(/Reason for rejection/)).toBeInTheDocument();
  });

  it('calls buildSignedAction with correct APPROVE payload', async () => {
    const jr = makeJoinRequest();
    const authFetch = makeAuthFetch({
      joinItems: [jr],
      mutationResponse: makeProposal(),
    });
    await openApproveForm(authFetch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign & Raise Approve/ }));
    });

    expect(mockSign).toHaveBeenCalledTimes(1);
    const [payload, , chainId, addr] = mockSign.mock.calls[0];
    expect(chainId).toBe('mychain-1');
    expect(addr).toBe(ADDRESS);
    expect(payload).toMatchObject({
      action_type: 'APPROVE_VALIDATOR',
      coordinator_address: ADDRESS,
      payload: {
        join_request_id: jr.id,
        operator_address: jr.operator_address,
      },
    });
  });

  it('calls POST /launch/{id}/proposal with signed body', async () => {
    const authFetch = makeAuthFetch({
      joinItems: [makeJoinRequest()],
      mutationResponse: makeProposal(),
    });
    await openApproveForm(authFetch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign & Raise Approve/ }));
    });

    const proposalCall = authFetch.mock.calls.find(
      ([url]: [string]) => url === `/launch/${LAUNCH_ID}/proposal`,
    );
    expect(proposalCall).toBeDefined();
    expect(proposalCall[1].method).toBe('POST');
    const body = JSON.parse(proposalCall[1].body);
    expect(body.nonce).toBe('test-nonce');
    expect(body.signature).toBe('testsig==');
  });

  it('shows raised proposal feedback and dismisses form on success', async () => {
    const authFetch = makeAuthFetch({
      joinItems: [makeJoinRequest()],
      mutationResponse: makeProposal(),
    });
    await openApproveForm(authFetch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign & Raise Approve/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Proposal raised/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Approve Validator')).not.toBeInTheDocument();
  });

  it('shows server error on failure', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [makeJoinRequest()] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: false, status: 403, json: async () => ({ message: 'not a committee member' }) };
    });
    await openApproveForm(authFetch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign & Raise Approve/ }));
    });

    await waitFor(() => {
      expect(screen.getByText('not a committee member')).toBeInTheDocument();
    });
  });

  it('Cancel button dismisses the proposal form', async () => {
    const authFetch = makeAuthFetch({ joinItems: [makeJoinRequest()] });
    await openApproveForm(authFetch);

    expect(screen.getByText('Approve Validator')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByText('Approve Validator')).not.toBeInTheDocument();
  });
});

// ── H.9 — Proposal list + sign/veto ──────────────────────────────────────────

describe('CoordinatorPanel — ProposalListSection (H.9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedResult();
  });

  it('shows empty state when no proposals', async () => {
    render(<CoordinatorPanel {...defaultProps()} />);
    await waitFor(() => {
      expect(screen.getByText(/No proposals yet/)).toBeInTheDocument();
    });
  });

  it('renders proposal action type and status', async () => {
    const authFetch = makeAuthFetch({ proposalItems: [makeProposal()] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.getByText('APPROVE VALIDATOR')).toBeInTheDocument();
      expect(screen.getByText('PENDING')).toBeInTheDocument();
    });
  });

  it('shows Sign and Veto buttons for pending proposals with no prior decision', async () => {
    const authFetch = makeAuthFetch({ proposalItems: [makeProposal({ signatures: [] })] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Veto' })).toBeInTheDocument();
    });
  });

  it('hides Sign/Veto buttons when coordinator already signed', async () => {
    const proposal = makeProposal({
      signatures: [{ coordinator_address: ADDRESS, decision: 'sign', timestamp: '2026-05-01T00:00:00Z' }],
    });
    const authFetch = makeAuthFetch({ proposalItems: [proposal] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Veto' })).not.toBeInTheDocument();
      expect(screen.getByText(/You signed this proposal/)).toBeInTheDocument();
    });
  });

  it('hides Sign/Veto for executed proposals', async () => {
    const authFetch = makeAuthFetch({ proposalItems: [makeProposal({ status: 'executed' })] });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    });
  });

  it('calls POST /launch/{id}/proposal/{prop_id}/sign with decision=sign', async () => {
    const updatedProposal = makeProposal({
      signatures: [{ coordinator_address: ADDRESS, decision: 'sign', timestamp: '2026-05-01T00:00:00Z' }],
    });
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url === `/launch/${LAUNCH_ID}/proposals?per_page=100`) {
        return { ok: true, json: async () => ({ items: [makeProposal()] }) };
      }
      return { ok: true, json: async () => updatedProposal };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Sign' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    });

    const signCall = authFetch.mock.calls.find(
      ([url]: [string]) => url === `/launch/${LAUNCH_ID}/proposal/${PROP_ID}/sign`,
    );
    expect(signCall).toBeDefined();
    expect(signCall[1].method).toBe('POST');
    const body = JSON.parse(signCall[1].body);
    expect(body.decision).toBe('sign');
    expect(body.coordinator_address).toBe(ADDRESS);
  });

  it('calls POST with decision=veto when Veto is clicked', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals?')) return { ok: true, json: async () => ({ items: [makeProposal()] }) };
      return { ok: true, json: async () => makeProposal({ status: 'vetoed' }) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Veto' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Veto' }));
    });

    const signCall = authFetch.mock.calls.find(
      ([url]: [string]) => url === `/launch/${LAUNCH_ID}/proposal/${PROP_ID}/sign`,
    );
    const body = JSON.parse(signCall[1].body);
    expect(body.decision).toBe('veto');
  });

  it('updates proposal status in-place after signing', async () => {
    const signed = makeProposal({
      status: 'executed',
      signatures: [{ coordinator_address: ADDRESS, decision: 'sign', timestamp: '' }],
    });
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals?')) return { ok: true, json: async () => ({ items: [makeProposal()] }) };
      return { ok: true, json: async () => signed };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Sign' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    });

    await waitFor(() => {
      expect(screen.getByText('EXECUTED')).toBeInTheDocument();
    });
  });

  it('shows error message when signing fails', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals?')) return { ok: true, json: async () => ({ items: [makeProposal()] }) };
      return { ok: false, status: 409, json: async () => ({ message: 'already signed' }) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: 'Sign' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    });

    await waitFor(() => {
      expect(screen.getByText('already signed')).toBeInTheDocument();
    });
  });
});

// ── H.10 — Coordinator actions ────────────────────────────────────────────────

describe('CoordinatorPanel — CoordinatorActionsSection (H.10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows Open Application Window button on draft launch', async () => {
    render(<CoordinatorPanel {...defaultProps({ launch: { status: 'draft' } })} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open Application Window/ })).toBeInTheDocument();
    });
  });

  it('hides Open Application Window button on non-draft launch', async () => {
    render(<CoordinatorPanel {...defaultProps({ launch: { status: 'open' } })} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Open Application Window/ })).not.toBeInTheDocument();
    });
  });

  it('calls POST /launch/{id}/open-window on click', async () => {
    const updated = makeLaunch({ status: 'open' });
    const onLaunchUpdated = jest.fn();
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => updated };
    });
    render(<CoordinatorPanel {...defaultProps({ launch: { status: 'draft' }, authFetch, onLaunchUpdated })} />);
    await waitFor(() => screen.getByRole('button', { name: /Open Application Window/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open Application Window/ }));
    });

    const call = authFetch.mock.calls.find(([url]: [string]) => url === `/launch/${LAUNCH_ID}/open-window`);
    expect(call).toBeDefined();
    expect(call[1].method).toBe('POST');
    expect(onLaunchUpdated).toHaveBeenCalledWith(updated);
  });

  it('shows error when open-window fails', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: false, status: 409, json: async () => ({ message: 'already open' }) };
    });
    render(<CoordinatorPanel {...defaultProps({ launch: { status: 'draft' }, authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: /Open Application Window/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open Application Window/ }));
    });

    await waitFor(() => {
      expect(screen.getByText('already open')).toBeInTheDocument();
    });
  });

  it('pre-fills monitor RPC field with launch.monitor_rpc_url', async () => {
    render(<CoordinatorPanel {...defaultProps({ launch: { monitor_rpc_url: 'https://rpc.example.com' } })} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('https://rpc.example.com')).toBeInTheDocument();
    });
  });

  it('calls PATCH /launch/{id} with monitor_rpc_url', async () => {
    const updated = makeLaunch({ monitor_rpc_url: 'https://new-rpc.example.com' });
    const onLaunchUpdated = jest.fn();
    const authFetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      if (init?.method === 'PATCH') return { ok: true, json: async () => updated };
      return { ok: true, json: async () => ({}) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch, onLaunchUpdated })} />);

    // Wait for loading to finish, then type in the RPC field
    await waitFor(() => screen.getByPlaceholderText(/https:\/\/rpc\.mychain/));
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/rpc\.mychain/), {
      target: { value: 'https://new-rpc.example.com' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Set Monitor RPC/ }));
    });

    const patchCall = authFetch.mock.calls.find(
      ([url, init]: [string, RequestInit]) => url === `/launch/${LAUNCH_ID}` && init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall[1].body);
    expect(body.monitor_rpc_url).toBe('https://new-rpc.example.com');
    expect(onLaunchUpdated).toHaveBeenCalledWith(updated);
  });

  it('shows Saved confirmation after successful monitor RPC update', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      if (init?.method === 'PATCH') return { ok: true, json: async () => makeLaunch() };
      return { ok: true, json: async () => ({}) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByRole('button', { name: /Set Monitor RPC/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Set Monitor RPC/ }));
    });

    await waitFor(() => {
      expect(screen.getByText('Saved.')).toBeInTheDocument();
    });
  });

  it('calls POST /launch/{id}/genesis?type=initial for initial genesis upload', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({ sha256: 'abc123' }) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByPlaceholderText(/files\.example\.com/));

    fireEvent.change(screen.getByPlaceholderText(/files\.example\.com/), {
      target: { value: 'https://files.example.com/genesis.json' },
    });
    fireEvent.change(screen.getByPlaceholderText(/64-character hex/), {
      target: { value: 'abc123def456' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Genesis Reference/ }));
    });

    const genesisCall = authFetch.mock.calls.find(
      ([url]: [string]) => url === `/launch/${LAUNCH_ID}/genesis?type=initial`,
    );
    expect(genesisCall).toBeDefined();
    expect(genesisCall[1].method).toBe('POST');
    const body = JSON.parse(genesisCall[1].body);
    expect(body.url).toBe('https://files.example.com/genesis.json');
    expect(body.sha256).toBe('abc123def456');
  });

  it('shows genesis_time field only when final is selected', async () => {
    render(<CoordinatorPanel {...defaultProps()} />);
    await waitFor(() => screen.getByDisplayValue('initial'));
    expect(screen.queryByPlaceholderText(/2026-06-01T12/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByDisplayValue('final'));
    expect(screen.getByPlaceholderText(/2026-06-01T12/)).toBeInTheDocument();
  });

  it('requires URL and SHA-256 before submitting genesis', async () => {
    render(<CoordinatorPanel {...defaultProps()} />);
    await waitFor(() => screen.getByRole('button', { name: /Submit Genesis Reference/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Genesis Reference/ }));
    });

    expect(screen.getByText('URL is required.')).toBeInTheDocument();
  });

  it('shows Genesis reference saved after successful upload', async () => {
    const authFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/join')) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes('/proposals')) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({ sha256: 'abc123' }) };
    });
    render(<CoordinatorPanel {...defaultProps({ authFetch })} />);
    await waitFor(() => screen.getByPlaceholderText(/files\.example\.com/));

    fireEvent.change(screen.getByPlaceholderText(/files\.example\.com/), {
      target: { value: 'https://files.example.com/genesis.json' },
    });
    fireEvent.change(screen.getByPlaceholderText(/64-character hex/), {
      target: { value: 'abc123def456' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Genesis Reference/ }));
    });

    await waitFor(() => {
      expect(screen.getByText('Genesis reference saved.')).toBeInTheDocument();
    });
  });
});