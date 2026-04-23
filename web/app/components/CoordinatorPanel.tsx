import { useState, useEffect, useCallback } from 'react';
import { Box, Text } from '@interchain-ui/react';
import { CosmosWallet } from '@interchain-kit/core';
import type { StatefulWallet } from '@interchain-kit/react/store/stateful-wallet';
import { Button } from '@/components';
import { buildSignedAction, buildCanonicalActionPayload } from '@/utils/signedAction';
import type { ChainHint } from '@/utils/chainSuggestion';
import type { Committee, JoinRequest, Launch, Proposal } from '@/types';

// ── Shared UI primitives (mirrors ValidatorPanel) ─────────────────────────────

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box borderRadius="8px" border="1px solid" borderColor="$divider" p="20px">
      <Text fontSize="$md" fontWeight="$semibold" attributes={{ mb: '12px' }}>
        {title}
      </Text>
      <Box display="flex" flexDirection="column" gap="8px">
        {children}
      </Box>
    </Box>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="$xs" color="$textSecondary" attributes={{ mb: '2px' }}>
      {children}
    </Text>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--chakra-colors-divider, #e2e8f0)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '14px',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'pending'
      ? '$textSecondary'
      : status === 'approved'
      ? '$textSuccess'
      : '$textDanger';
  return (
    <Text fontSize="$xs" fontWeight="$semibold" color={color}>
      {status.toUpperCase()}
    </Text>
  );
}

function truncate(s: string, n = 20): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── H.8 — Raise proposal form ─────────────────────────────────────────────────

type ActionKind = 'APPROVE_VALIDATOR' | 'REJECT_VALIDATOR';

interface ProposalFormProps {
  launchId: string;
  hint: ChainHint;
  address: string;
  wallet: StatefulWallet;
  signingChainId: string;
  jr: JoinRequest;
  action: ActionKind;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onSuccess: (proposal: Proposal) => void;
  onCancel: () => void;
}

function ProposalForm({
  launchId,
  hint,
  address,
  wallet,
  signingChainId,
  jr,
  action,
  authFetch,
  onSuccess,
  onCancel,
}: ProposalFormProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);

    const payloadObj: Record<string, string> = {
      join_request_id: jr.id,
      operator_address: jr.operator_address,
    };
    if (action === 'REJECT_VALIDATOR') {
      payloadObj.reason = reason.trim();
    }

    setIsSubmitting(true);
    try {
      const body = {
        action_type: action,
        payload: payloadObj,
        coordinator_address: address,
      };

      const signed = await buildSignedAction(body, wallet, signingChainId, address);

      const r = await authFetch(`/launch/${launchId}/proposal`, {
        method: 'POST',
        body: JSON.stringify(signed),
      });

      if (!r.ok) {
        const envelope = await r.json().catch(() => ({}));
        setError((envelope as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }

      const proposal: Proposal = await r.json();
      onSuccess(proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const label = action === 'APPROVE_VALIDATOR' ? 'Approve Validator' : 'Reject Validator';

  return (
    <Box
      borderRadius="6px"
      border="1px solid"
      borderColor="$divider"
      p="16px"
      display="flex"
      flexDirection="column"
      gap="12px"
    >
      <Text fontSize="$sm" fontWeight="$semibold">{label}</Text>

      <Box>
        <FieldLabel>Join request</FieldLabel>
        <Text fontSize="$xs" fontFamily="monospace" color="$textSecondary">
          {jr.id}
        </Text>
      </Box>

      <Box>
        <FieldLabel>Operator address</FieldLabel>
        <Text fontSize="$xs" fontFamily="monospace">{jr.operator_address}</Text>
      </Box>

      {jr.memo && (
        <Box>
          <FieldLabel>Memo</FieldLabel>
          <Text fontSize="$xs">{jr.memo}</Text>
        </Box>
      )}

      {action === 'REJECT_VALIDATOR' && (
        <Box>
          <FieldLabel>Reason (optional)</FieldLabel>
          <TextInput
            value={reason}
            onChange={setReason}
            placeholder="Reason for rejection"
            disabled={isSubmitting}
          />
        </Box>
      )}

      {error && (
        <Text fontSize="$sm" color="$textDanger">{error}</Text>
      )}

      <Box display="flex" gap="8px">
        <Button
          variant="primary"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing & Submitting…' : `Sign & Raise ${label} Proposal`}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}

// ── H.7 — Join request queue ──────────────────────────────────────────────────

interface JoinQueueSectionProps {
  launchId: string;
  hint: ChainHint;
  address: string;
  wallet: StatefulWallet;
  signingChainId: string;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

function JoinQueueSection({ launchId, hint, address, wallet, signingChainId, authFetch }: JoinQueueSectionProps) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // active proposal form state: which (join request, action) is being raised
  const [activeForm, setActiveForm] = useState<{ jr: JoinRequest; action: ActionKind } | null>(null);
  // proposals raised this session, keyed by join request id
  const [raisedProposals, setRaisedProposals] = useState<Record<string, Proposal>>({});

  const fetchQueue = useCallback(async () => {
    try {
      const r = await authFetch(`/launch/${launchId}/join?per_page=100`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setFetchError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }
      const envelope = await r.json() as { items: JoinRequest[] };
      setRequests((envelope.items ?? []).map((jr) => ({ ...jr, status: jr.status.toLowerCase() as JoinRequest['status'] })));
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  }, [launchId, authFetch]);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 30_000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  const handleProposalSuccess = (jr: JoinRequest, proposal: Proposal) => {
    setRaisedProposals((prev) => ({ ...prev, [jr.id]: proposal }));
    setActiveForm(null);
    fetchQueue();
  };

  if (isLoading) {
    return (
      <PanelCard title="Join Request Queue">
        <Text fontSize="$sm" color="$textSecondary">Loading…</Text>
      </PanelCard>
    );
  }

  if (fetchError) {
    return (
      <PanelCard title="Join Request Queue">
        <Text fontSize="$sm" color="$textDanger">{fetchError}</Text>
      </PanelCard>
    );
  }

  if (requests.length === 0) {
    return (
      <PanelCard title="Join Request Queue">
        <Text fontSize="$sm" color="$textSecondary">No join requests yet.</Text>
      </PanelCard>
    );
  }

  return (
    <PanelCard title={`Join Request Queue (${requests.length})`}>
      <Box display="flex" flexDirection="column" gap="12px">
        {requests.map((jr) => {
          const isPending = jr.status === 'pending';
          const raised = raisedProposals[jr.id];
          const isActiveApprove = activeForm?.jr.id === jr.id && activeForm.action === 'APPROVE_VALIDATOR';
          const isActiveReject = activeForm?.jr.id === jr.id && activeForm.action === 'REJECT_VALIDATOR';

          return (
            <Box
              key={jr.id}
              borderRadius="6px"
              border="1px solid"
              borderColor="$divider"
              p="12px"
              display="flex"
              flexDirection="column"
              gap="8px"
            >
              {/* Row header */}
              <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Box display="flex" flexDirection="column" gap="2px">
                  <Text fontSize="$xs" fontFamily="monospace">
                    {truncate(jr.operator_address, 32)}
                  </Text>
                  {jr.memo && (
                    <Text fontSize="$xs" color="$textSecondary">{jr.memo}</Text>
                  )}
                  <Text fontSize="$xs" color="$textSecondary">
                    {new Date(jr.submitted_at).toLocaleString()} · {jr.peer_address}
                  </Text>
                </Box>
                <StatusBadge status={jr.status} />
              </Box>

              {/* Session-raised proposal feedback */}
              {raised && (
                <Text fontSize="$xs" color="$textSuccess">
                  Proposal raised: {raised.action_type} · {raised.status} · ID {truncate(raised.id, 16)}
                </Text>
              )}

              {/* Action buttons (pending only) */}
              {isPending && !raised && (
                <Box display="flex" gap="8px">
                  <Button
                    variant="primary"
                    onClick={() => setActiveForm({ jr, action: 'APPROVE_VALIDATOR' })}
                    disabled={!!activeForm}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActiveForm({ jr, action: 'REJECT_VALIDATOR' })}
                    disabled={!!activeForm}
                  >
                    Reject
                  </Button>
                </Box>
              )}

              {/* Inline proposal form */}
              {(isActiveApprove || isActiveReject) && (
                <ProposalForm
                  launchId={launchId}
                  hint={hint}
                  address={address}
                  wallet={wallet}
                  signingChainId={signingChainId}
                  jr={jr}
                  action={activeForm!.action}
                  authFetch={authFetch}
                  onSuccess={(p) => handleProposalSuccess(jr, p)}
                  onCancel={() => setActiveForm(null)}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </PanelCard>
  );
}

// ── H.9 — Proposal list + sign/veto ──────────────────────────────────────────

interface ProposalListSectionProps {
  launchId: string;
  hint: ChainHint;
  address: string;
  wallet: StatefulWallet;
  signingChainId: string;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

function ProposalListSection({
  launchId,
  hint,
  address,
  wallet,
  signingChainId,
  authFetch,
}: ProposalListSectionProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // signing state per proposal: null = idle, 'signing' = in flight, string = error
  const [signingState, setSigningState] = useState<Record<string, string | 'signing' | null>>({});

  const fetchProposals = useCallback(async () => {
    try {
      const r = await authFetch(`/launch/${launchId}/proposals?per_page=100`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setFetchError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }
      const envelope = await r.json() as { items: Proposal[] };
      setProposals((envelope.items ?? []).map((p) => ({ ...p, status: p.status.toLowerCase() as Proposal['status'] })));
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  }, [launchId, authFetch]);

  useEffect(() => {
    fetchProposals();
    const id = setInterval(fetchProposals, 30_000);
    return () => clearInterval(id);
  }, [fetchProposals]);

  const handleDecision = async (proposal: Proposal, decision: 'sign' | 'veto') => {
    setSigningState((prev) => ({ ...prev, [proposal.id]: 'signing' }));
    try {
      const body = {
        coordinator_address: address,
        decision,
      };
      const signed = await buildSignedAction(body, wallet, signingChainId, address);

      const r = await authFetch(`/launch/${launchId}/proposal/${proposal.id}/sign`, {
        method: 'POST',
        body: JSON.stringify(signed),
      });

      if (!r.ok) {
        const envelope = await r.json().catch(() => ({}));
        const msg = (envelope as { message?: string }).message ?? `Server returned ${r.status}`;
        setSigningState((prev) => ({ ...prev, [proposal.id]: msg }));
        return;
      }

      const updated: Proposal = await r.json();
      const normalizedUpdated = { ...updated, status: updated.status.toLowerCase() as Proposal['status'] };
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? normalizedUpdated : p)));
      setSigningState((prev) => ({ ...prev, [proposal.id]: null }));
    } catch (err) {
      setSigningState((prev) => ({
        ...prev,
        [proposal.id]: err instanceof Error ? err.message : 'Unexpected error',
      }));
    }
  };

  if (isLoading) {
    return (
      <PanelCard title="Proposals">
        <Text fontSize="$sm" color="$textSecondary">Loading…</Text>
      </PanelCard>
    );
  }

  if (fetchError) {
    return (
      <PanelCard title="Proposals">
        <Text fontSize="$sm" color="$textDanger">{fetchError}</Text>
      </PanelCard>
    );
  }

  if (proposals.length === 0) {
    return (
      <PanelCard title="Proposals">
        <Text fontSize="$sm" color="$textSecondary">No proposals yet.</Text>
      </PanelCard>
    );
  }

  const pendingFirst = [...proposals].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return new Date(b.proposed_at).getTime() - new Date(a.proposed_at).getTime();
  });

  return (
    <PanelCard title={`Proposals (${proposals.length})`}>
      <Box display="flex" flexDirection="column" gap="12px">
        {pendingFirst.map((p) => {
          const myDecision = p.signatures.find((s) => s.coordinator_address === address);
          const isPending = p.status === 'pending';
          const canAct = isPending && !myDecision;
          const state = signingState[p.id];
          const isSigning = state === 'signing';
          const signError = typeof state === 'string' && state !== 'signing' ? state : null;

          return (
            <Box
              key={p.id}
              borderRadius="6px"
              border="1px solid"
              borderColor="$divider"
              p="12px"
              display="flex"
              flexDirection="column"
              gap="8px"
            >
              {/* Header row */}
              <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Box display="flex" flexDirection="column" gap="2px">
                  <Text fontSize="$sm" fontWeight="$semibold">
                    {p.action_type.replace(/_/g, ' ')}
                  </Text>
                  <Text fontSize="$xs" color="$textSecondary">
                    Proposed by {truncate(p.proposed_by, 24)} · {new Date(p.proposed_at).toLocaleString()}
                  </Text>
                  {isPending && (
                    <Text fontSize="$xs" color="$textSecondary">
                      Expires {new Date(p.ttl_expires).toLocaleString()}
                    </Text>
                  )}
                </Box>
                <StatusBadge status={p.status} />
              </Box>

              {/* Signatures */}
              {p.signatures.length > 0 && (
                <Box display="flex" flexDirection="column" gap="2px">
                  {p.signatures.map((s) => (
                    <Text key={s.coordinator_address} fontSize="$xs" color="$textSecondary">
                      {s.decision === 'sign' ? '✓' : '✗'} {truncate(s.coordinator_address, 24)}
                    </Text>
                  ))}
                </Box>
              )}

              {/* My prior decision */}
              {myDecision && (
                <Text fontSize="$xs" color={myDecision.decision === 'sign' ? '$textSuccess' : '$textDanger'}>
                  You {myDecision.decision === 'sign' ? 'signed' : 'vetoed'} this proposal.
                </Text>
              )}

              {/* Sign / Veto buttons */}
              {canAct && (
                <Box display="flex" gap="8px">
                  <Button
                    variant="primary"
                    onClick={() => handleDecision(p, 'sign')}
                    isLoading={isSigning}
                    disabled={isSigning}
                  >
                    {isSigning ? 'Signing…' : 'Sign'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleDecision(p, 'veto')}
                    disabled={isSigning}
                  >
                    Veto
                  </Button>
                </Box>
              )}

              {signError && (
                <Text fontSize="$xs" color="$textDanger">{signError}</Text>
              )}
            </Box>
          );
        })}
      </Box>
    </PanelCard>
  );
}

// ── H.10 — Coordinator actions ────────────────────────────────────────────────

interface CoordinatorActionsSectionProps {
  launchId: string;
  launch: Launch;
  isLead: boolean;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onLaunchUpdated: (l: Launch) => void;
}

function CoordinatorActionsSection({
  launchId,
  launch,
  isLead,
  authFetch,
  onLaunchUpdated,
}: CoordinatorActionsSectionProps) {
  // Open window
  const [openWindowBusy, setOpenWindowBusy] = useState(false);
  const [openWindowError, setOpenWindowError] = useState<string | null>(null);

  // Cancel launch
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  // Monitor RPC
  const [monitorRPC, setMonitorRPC] = useState(launch.monitor_rpc_url ?? '');
  const [monitorRPCBusy, setMonitorRPCBusy] = useState(false);
  const [monitorRPCError, setMonitorRPCError] = useState<string | null>(null);
  const [monitorRPCSaved, setMonitorRPCSaved] = useState(false);

  // Genesis upload
  const [genesisURL, setGenesisURL] = useState('');
  const [genesisSHA256, setGenesisSHA256] = useState('');
  const [genesisTime, setGenesisTime] = useState('');
  const [genesisType, setGenesisType] = useState<'initial' | 'final'>('initial');
  const [genesisBusy, setGenesisBusy] = useState(false);
  const [genesisError, setGenesisError] = useState<string | null>(null);
  const [genesisSaved, setGenesisSaved] = useState(false);

  const handleOpenWindow = async () => {
    setOpenWindowBusy(true);
    setOpenWindowError(null);
    try {
      const r = await authFetch(`/launch/${launchId}/open-window`, { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setOpenWindowError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }
      const updated: Launch = await r.json();
      onLaunchUpdated(updated);
    } catch (err) {
      setOpenWindowError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setOpenWindowBusy(false);
    }
  };

  const handleSetMonitorRPC = async () => {
    setMonitorRPCBusy(true);
    setMonitorRPCError(null);
    setMonitorRPCSaved(false);
    try {
      const r = await authFetch(`/launch/${launchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ monitor_rpc_url: monitorRPC.trim() }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setMonitorRPCError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }
      const updated: Launch = await r.json();
      onLaunchUpdated(updated);
      setMonitorRPCSaved(true);
    } catch (err) {
      setMonitorRPCError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setMonitorRPCBusy(false);
    }
  };

  const handleCancel = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const r = await authFetch(`/launch/${launchId}/cancel`, { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setCancelError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }
      const updated: Launch = await r.json();
      onLaunchUpdated(updated);
      setCancelConfirm(false);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setCancelBusy(false);
    }
  };

  const handleGenesisUpload = async () => {
    setGenesisBusy(true);
    setGenesisError(null);
    setGenesisSaved(false);

    if (!genesisURL.trim()) {
      setGenesisError('URL is required.');
      setGenesisBusy(false);
      return;
    }
    if (!genesisSHA256.trim()) {
      setGenesisError('SHA-256 is required.');
      setGenesisBusy(false);
      return;
    }
    if (genesisType === 'final' && !genesisTime.trim()) {
      setGenesisError('Genesis time is required for final genesis.');
      setGenesisBusy(false);
      return;
    }

    try {
      const body: Record<string, string> = {
        url: genesisURL.trim(),
        sha256: genesisSHA256.trim(),
      };
      if (genesisType === 'final') body.genesis_time = genesisTime.trim();

      const r = await authFetch(`/launch/${launchId}/genesis?type=${genesisType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const envelope = await r.json().catch(() => ({}));
        setGenesisError((envelope as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }

      const result = await r.json().catch(() => ({})) as { sha256?: string };
      setGenesisSaved(true);
      setGenesisURL('');
      setGenesisSHA256('');
      setGenesisTime('');
      if (result.sha256) {
        const key = genesisType === 'final' ? 'final_genesis_sha256' : 'initial_genesis_sha256';
        onLaunchUpdated({ ...launch, [key]: result.sha256 });
      }
    } catch (err) {
      setGenesisError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setGenesisBusy(false);
    }
  };

  const isDraft = launch.status === 'draft';

  return (
    <PanelCard title="Coordinator Actions">
      <Box display="flex" flexDirection="column" gap="16px">

        {/* Open application window */}
        {isDraft && (
          <Box display="flex" flexDirection="column" gap="8px">
            <Text fontSize="$sm" fontWeight="$semibold">Open Application Window</Text>
            <Text fontSize="$xs" color="$textSecondary">
              Transitions this launch from DRAFT to OPEN so validators can submit join requests.
            </Text>
            {openWindowError && (
              <Text fontSize="$xs" color="$textDanger">{openWindowError}</Text>
            )}
            <Button
              variant="primary"
              onClick={handleOpenWindow}
              isLoading={openWindowBusy}
              disabled={openWindowBusy}
            >
              {openWindowBusy ? 'Opening…' : 'Open Application Window'}
            </Button>
          </Box>
        )}

        {/* Monitor RPC URL */}
        <Box display="flex" flexDirection="column" gap="8px">
          <Text fontSize="$sm" fontWeight="$semibold">Monitor RPC URL</Text>
          <Text fontSize="$xs" color="$textSecondary">
            CometBFT RPC endpoint for block-height monitoring. Can be updated at any launch status.
          </Text>
          <TextInput
            value={monitorRPC}
            onChange={(v) => { setMonitorRPC(v); setMonitorRPCSaved(false); }}
            placeholder="https://rpc.mychain.example.com"
            disabled={monitorRPCBusy}
          />
          {monitorRPCError && (
            <Text fontSize="$xs" color="$textDanger">{monitorRPCError}</Text>
          )}
          {monitorRPCSaved && (
            <Text fontSize="$xs" color="$textSuccess">Saved.</Text>
          )}
          <Button
            variant="primary"
            onClick={handleSetMonitorRPC}
            isLoading={monitorRPCBusy}
            disabled={monitorRPCBusy}
          >
            {monitorRPCBusy ? 'Saving…' : 'Set Monitor RPC'}
          </Button>
        </Box>

        {/* Genesis upload (attestor mode) */}
        <Box display="flex" flexDirection="column" gap="8px">
          <Text fontSize="$sm" fontWeight="$semibold">Upload Genesis Reference</Text>
          <Text fontSize="$xs" color="$textSecondary">
            Attestor mode: provide a public URL and SHA-256 hash. The server stores the reference; validators download directly.
          </Text>

          <Box display="flex" gap="12px">
            {(['initial', 'final'] as const).map((t) => (
              <Box
                key={t}
                as="label"
                display="flex"
                gap="4px"
                alignItems="center"
                attributes={{ style: { cursor: 'pointer', fontSize: '13px' } }}
              >
                <input
                  type="radio"
                  name="genesis-type"
                  value={t}
                  checked={genesisType === t}
                  onChange={() => setGenesisType(t)}
                />
                <Text fontSize="$xs">{t === 'initial' ? 'Initial' : 'Final'}</Text>
              </Box>
            ))}
          </Box>

          <Box>
            <FieldLabel>Public URL *</FieldLabel>
            <TextInput
              value={genesisURL}
              onChange={setGenesisURL}
              placeholder="https://files.example.com/genesis.json"
              disabled={genesisBusy}
            />
          </Box>

          <Box>
            <FieldLabel>SHA-256 *</FieldLabel>
            <TextInput
              value={genesisSHA256}
              onChange={setGenesisSHA256}
              placeholder="64-character hex digest"
              disabled={genesisBusy}
            />
          </Box>

          {genesisType === 'final' && (
            <Box>
              <FieldLabel>Genesis time (RFC 3339) *</FieldLabel>
              <TextInput
                value={genesisTime}
                onChange={setGenesisTime}
                placeholder="2026-06-01T12:00:00Z"
                disabled={genesisBusy}
              />
            </Box>
          )}

          {genesisError && (
            <Text fontSize="$xs" color="$textDanger">{genesisError}</Text>
          )}
          {genesisSaved && (
            <Text fontSize="$xs" color="$textSuccess">Genesis reference saved.</Text>
          )}

          <Button
            variant="primary"
            onClick={handleGenesisUpload}
            isLoading={genesisBusy}
            disabled={genesisBusy}
          >
            {genesisBusy ? 'Uploading…' : 'Submit Genesis Reference'}
          </Button>
        </Box>

        {/* Cancel launch — lead only, non-terminal status */}
        {isLead && launch.status !== 'launched' && launch.status !== 'canceled' && (
          <Box display="flex" flexDirection="column" gap="8px">
            <Text fontSize="$sm" fontWeight="$semibold" color="$textDanger">Cancel Launch</Text>
            <Text fontSize="$xs" color="$textSecondary">
              Emergency action. Immediately transitions this launch to CANCELED. Cannot be undone.
            </Text>
            {cancelError && (
              <Text fontSize="$xs" color="$textDanger">{cancelError}</Text>
            )}
            {!cancelConfirm ? (
              <Button variant="outline" size="sm" onClick={() => setCancelConfirm(true)}>
                Cancel Launch
              </Button>
            ) : (
              <Box display="flex" gap="8px" alignItems="center">
                <Text fontSize="$xs" color="$textDanger">Are you sure?</Text>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCancel}
                  isLoading={cancelBusy}
                  disabled={cancelBusy}
                >
                  {cancelBusy ? 'Canceling…' : 'Confirm Cancel'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCancelConfirm(false)} disabled={cancelBusy}>
                  Keep Launch
                </Button>
              </Box>
            )}
          </Box>
        )}

      </Box>
    </PanelCard>
  );
}

// ── Gentxs download ───────────────────────────────────────────────────────────

interface GentxsSectionProps {
  launchId: string;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

function GentxsSection({ launchId, authFetch }: GentxsSectionProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/launch/${launchId}/gentxs`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gentxs-${launchId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <PanelCard title="Download Gentxs">
      <Text fontSize="$xs" color="$textSecondary">
        Download all approved validator gentxs as a JSON bundle. Use this to assemble the final genesis file.
      </Text>
      {error && <Text fontSize="$xs" color="$textDanger">{error}</Text>}
      <Button variant="primary" onClick={handleDownload} isLoading={isBusy} disabled={isBusy}>
        {isBusy ? 'Downloading…' : 'Download gentxs.json'}
      </Button>
    </PanelCard>
  );
}

// ── Replace committee (DRAFT + lead only) ────────────────────────────────────

interface ReplaceCommitteeSectionProps {
  launchId: string;
  address: string;
  wallet: StatefulWallet;
  signingChainId: string;
  committee: Committee;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onCommitteeUpdated: (c: Committee) => void;
}

interface MemberInput {
  address: string;
  moniker: string;
  pubKeyB64: string;
}

function ReplaceCommitteeSection({
  launchId,
  address,
  wallet,
  signingChainId,
  committee,
  authFetch,
  onCommitteeUpdated,
}: ReplaceCommitteeSectionProps) {
  const [open, setOpen] = useState(false);
  const [thresholdM, setThresholdM] = useState(String(committee.threshold_m));
  const [totalN, setTotalN] = useState(String(committee.total_n));
  const [members, setMembers] = useState<MemberInput[]>(
    committee.members.map((m) => ({ address: m.address, moniker: m.moniker, pubKeyB64: m.pub_key_b64 })),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function updateMember(idx: number, field: keyof MemberInput, value: string) {
    setMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  }

  function addMember() {
    setMembers((prev) => [...prev, { address: '', moniker: '', pubKeyB64: '' }]);
    setTotalN((n) => String(Number(n) + 1));
  }

  function removeMember(idx: number) {
    if (idx === 0) return;
    setMembers((prev) => prev.filter((_, i) => i !== idx));
    setTotalN((n) => String(Math.max(1, Number(n) - 1)));
  }

  const handleSubmit = async () => {
    setError(null);
    const m = Number(thresholdM);
    const n = Number(totalN);
    if (m < 1 || m > n) { setError(`threshold_m must be between 1 and ${n}`); return; }
    if (members.length !== n) { setError(`member count (${members.length}) must equal total_n (${n})`); return; }

    setIsSubmitting(true);
    try {
      const cosmosWallet =
        wallet?.getWalletOfType?.(CosmosWallet) ??
        (wallet?.originalWallet as any)?.getWalletByChainType?.('cosmos') ??
        (typeof (wallet?.originalWallet as any)?.signArbitrary === 'function'
          ? (wallet.originalWallet as any)
          : null);

      const committeePayload = {
        lead_address: address,
        members: members.map((mb) => ({ address: mb.address, moniker: mb.moniker })),
        threshold_m: m,
        total_n: n,
      };
      const payloadStr = buildCanonicalActionPayload(committeePayload);

      let stdSig: { pub_key: { value: string }; signature: string };
      if (cosmosWallet) {
        stdSig = await cosmosWallet.signArbitrary(signingChainId, address, payloadStr);
      } else if (typeof (window as any).keplr?.signArbitrary === 'function') {
        stdSig = await (window as any).keplr.signArbitrary(signingChainId, address, payloadStr);
      } else {
        throw new Error('No Cosmos wallet found');
      }

      const finalMembers = members.map((mb, i) =>
        i === 0 ? { ...mb, pubKeyB64: stdSig.pub_key.value } : mb,
      );

      const r = await authFetch(`/launch/${launchId}/committee`, {
        method: 'POST',
        body: JSON.stringify({
          members: finalMembers.map((mb) => ({
            address: mb.address.trim(),
            moniker: mb.moniker.trim(),
            pub_key_b64: mb.pubKeyB64,
          })),
          threshold_m: m,
          total_n: n,
          lead_address: address,
          creation_signature: stdSig.signature,
        }),
      });

      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError((body as { message?: string }).message ?? `Server returned ${r.status}`);
        return;
      }

      const updated: Committee = await r.json();
      onCommitteeUpdated(updated);
      setSuccess(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PanelCard title="Replace Committee">
      {success && (
        <Text fontSize="$xs" color="$textSuccess" attributes={{ mb: '4px' }}>Committee updated.</Text>
      )}
      {!open ? (
        <Box display="flex" flexDirection="column" gap="8px">
          <Text fontSize="$xs" color="$textSecondary">
            Replace the committee members or thresholds. Only available while the launch is in DRAFT status.
          </Text>
          <Button variant="outline" size="sm" onClick={() => { setOpen(true); setSuccess(false); }}>
            Edit Committee
          </Button>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column" gap="12px">
          <Box display="flex" gap="12px">
            <Box display="flex" flexDirection="column" gap="4px" attributes={{ style: { flex: 1 } }}>
              <FieldLabel>Threshold M</FieldLabel>
              <TextInput value={thresholdM} onChange={setThresholdM} placeholder="1" disabled={isSubmitting} />
            </Box>
            <Box display="flex" flexDirection="column" gap="4px" attributes={{ style: { flex: 1 } }}>
              <FieldLabel>Total N</FieldLabel>
              <TextInput
                value={totalN}
                onChange={(v) => {
                  setTotalN(v);
                  const n = Number(v);
                  if (members.length < n) {
                    setMembers((prev) => [
                      ...prev,
                      ...Array(n - prev.length).fill(null).map(() => ({ address: '', moniker: '', pubKeyB64: '' })),
                    ]);
                  } else if (members.length > n && n >= 1) {
                    setMembers((prev) => prev.slice(0, n));
                  }
                }}
                placeholder="1"
                disabled={isSubmitting}
              />
            </Box>
          </Box>

          {members.map((mb, idx) => (
            <Box
              key={idx}
              borderRadius="6px"
              border="1px solid"
              borderColor="$divider"
              p="12px"
              display="flex"
              flexDirection="column"
              gap="8px"
            >
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Text fontSize="$xs" color="$textSecondary">
                  {idx === 0 ? 'Lead (you)' : `Member ${idx + 1}`}
                </Text>
                {idx > 0 && (
                  <Button variant="text" size="sm" onClick={() => removeMember(idx)} disabled={isSubmitting}>
                    Remove
                  </Button>
                )}
              </Box>
              <TextInput
                value={mb.address}
                onChange={(v) => updateMember(idx, 'address', v)}
                placeholder="cosmos1…"
                disabled={idx === 0 || isSubmitting}
              />
              <TextInput
                value={mb.moniker}
                onChange={(v) => updateMember(idx, 'moniker', v)}
                placeholder="Moniker (optional)"
                disabled={isSubmitting}
              />
            </Box>
          ))}

          <Button variant="outline" size="sm" onClick={addMember} disabled={isSubmitting}>
            + Add Member
          </Button>

          {error && <Text fontSize="$xs" color="$textDanger">{error}</Text>}

          <Box display="flex" gap="8px">
            <Button variant="primary" onClick={handleSubmit} isLoading={isSubmitting} disabled={isSubmitting}>
              {isSubmitting ? 'Signing & Saving…' : 'Update Committee'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
          </Box>
        </Box>
      )}
    </PanelCard>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface CoordinatorPanelProps {
  launchId: string;
  hint: ChainHint;
  address: string;
  wallet: StatefulWallet;
  signingChainId: string;
  launch: Launch;
  committee: Committee;
  isLead: boolean;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onLaunchUpdated: (l: Launch) => void;
  onCommitteeUpdated: (c: Committee) => void;
}

export function CoordinatorPanel({
  launchId,
  hint,
  address,
  wallet,
  signingChainId,
  launch,
  committee,
  isLead,
  authFetch,
  onLaunchUpdated,
  onCommitteeUpdated,
}: CoordinatorPanelProps) {
  return (
    <Box display="flex" flexDirection="column" gap="16px">
      <CoordinatorActionsSection
        launchId={launchId}
        launch={launch}
        isLead={isLead}
        authFetch={authFetch}
        onLaunchUpdated={onLaunchUpdated}
      />
      <GentxsSection launchId={launchId} authFetch={authFetch} />
      {isLead && launch.status === 'draft' && (
        <ReplaceCommitteeSection
          launchId={launchId}
          address={address}
          wallet={wallet}
          signingChainId={signingChainId}
          committee={committee}
          authFetch={authFetch}
          onCommitteeUpdated={onCommitteeUpdated}
        />
      )}
      <JoinQueueSection
        launchId={launchId}
        hint={hint}
        address={address}
        wallet={wallet}
        signingChainId={signingChainId}
        authFetch={authFetch}
      />
      <ProposalListSection
        launchId={launchId}
        hint={hint}
        address={address}
        wallet={wallet}
        signingChainId={signingChainId}
        authFetch={authFetch}
      />
    </Box>
  );
}