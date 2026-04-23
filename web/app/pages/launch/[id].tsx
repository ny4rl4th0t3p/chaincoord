import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Box, Text } from '@interchain-ui/react';
import { useChain } from '@interchain-kit/react';
import { Button } from '@/components';
import { ValidatorPanel } from '@/components/ValidatorPanel';
import { CoordinatorPanel } from '@/components/CoordinatorPanel';
import { useAddChainToWallet, useAuthFetch } from '@/hooks';
import { useAuth } from '@/contexts';
import { ChainHint } from '@/utils/chainSuggestion';
import { Launch, Committee, Dashboard, AuditEntry } from '@/types';

// ── Top-level page ─────────────────────────────────────────────────────────────

export default function LaunchDetail() {
  const router = useRouter();
  const launchId = router.query.id as string;
  const { isAuthenticated, chainName } = useAuth();

  if (!launchId) return null;

  if (isAuthenticated && chainName) {
    return <AuthenticatedLaunchDetail launchId={launchId} />;
  }

  return <UnauthenticatedLanding launchId={launchId} />;
}

// ── Unauthenticated landing — two-path or validator flow ──────────────────────

function UnauthenticatedLanding({ launchId }: { launchId: string }) {
  const [validatorMode, setValidatorMode] = useState(false);
  const { addChain, isPending, isRegistered, hint, error } = useAddChainToWallet(launchId);

  if (!validatorMode) {
    return (
      <Box maxWidth="800px" mx="auto" mt="60px">
        <StepCard
          title="Access this launch"
          description="Choose how you are participating in this launch."
        >
          <Box display="flex" flexDirection="column" gap="12px" alignItems="center">
            <Box
              borderRadius="6px"
              border="1px solid"
              borderColor="$divider"
              p="16px"
              width="100%"
              maxWidth="400px"
            >
              <Text fontSize="$sm" fontWeight="$semibold" attributes={{ mb: '4px' }}>
                Coordinator or returning user
              </Text>
              <Text fontSize="$xs" color="$textSecondary">
                Use the Sign In button in the header to authenticate with your coordinator wallet.
              </Text>
            </Box>
            <Box
              borderRadius="6px"
              border="1px solid"
              borderColor="$divider"
              p="16px"
              width="100%"
              maxWidth="400px"
            >
              <Text fontSize="$sm" fontWeight="$semibold" attributes={{ mb: '8px' }}>
                New validator
              </Text>
              <Text fontSize="$xs" color="$textSecondary" attributes={{ mb: '12px' }}>
                Register this chain in your wallet and authenticate with your validator address.
              </Text>
              <Button variant="primary" size="sm" onClick={() => setValidatorMode(true)}>
                Join as Validator
              </Button>
            </Box>
          </Box>
        </StepCard>
      </Box>
    );
  }

  // Validator onboarding — add chain step
  if (!isRegistered) {
    return (
      <Box maxWidth="800px" mx="auto" mt="60px">
        <StepCard
          title="Add chain to wallet"
          description="Before you can authenticate, this chain must be registered in your wallet extension."
          error={error?.message}
        >
          <Button variant="primary" onClick={addChain} isLoading={isPending} disabled={isPending}>
            {isPending ? 'Adding…' : 'Add Chain to Wallet'}
          </Button>
        </StepCard>
      </Box>
    );
  }

  // Chain registered — connect + sign-in
  return (
    <Box maxWidth="800px" mx="auto" mt="60px">
      <ValidatorConnectAndAuth launchId={launchId} hint={hint!} />
    </Box>
  );
}

// ── Per-launch connect + sign-in (validator path) ─────────────────────────────

function ValidatorConnectAndAuth({ launchId, hint }: { launchId: string; hint: ChainHint }) {
  const { address, connect, wallet } = useChain(hint.chain_name);
  const { isPending, error, login } = useAuth();

  if (!address) {
    return (
      <StepCard
        title="Connect wallet"
        description={`Chain "${hint.chain_name}" registered. Connect your wallet to continue.`}
      >
        <Button variant="primary" onClick={connect}>
          Connect Wallet
        </Button>
      </StepCard>
    );
  }

  return (
    <StepCard
      title="Authenticate"
      description={`Connected as ${address}. Sign a challenge to prove ownership.`}
      error={error ?? undefined}
    >
      <Button
        variant="primary"
        onClick={() => login(wallet, hint.chain_id, hint.chain_name, address)}
        isLoading={isPending}
        disabled={isPending}
      >
        {isPending ? 'Signing…' : 'Sign In'}
      </Button>
    </StepCard>
  );
}

// ── Authenticated detail view ──────────────────────────────────────────────────

function AuthenticatedLaunchDetail({ launchId }: { launchId: string }) {
  const { operatorAddress, chainName, logout, revokeAllSessions } = useAuth();
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const { wallet, chain } = useChain(chainName!);
  const signingChainId = chain.chainId as string;
  const { authFetch } = useAuthFetch();

  const [launch, setLaunch] = useState<Launch | null>(null);
  const [committee, setCommittee] = useState<Committee | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseEvents, setSseEvents] = useState<string[]>([]);

  // Session controls are always rendered so they remain accessible even if the launch fails to load.
  const sessionControls = (
    <Box display="flex" gap="8px" alignItems="center">
      {revokeConfirm ? (
        <>
          <Text fontSize="$xs" color="$textDanger">Revoke all sessions?</Text>
          <Button variant="outline" size="sm" onClick={() => { revokeAllSessions(); setRevokeConfirm(false); }}>
            Confirm
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRevokeConfirm(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setRevokeConfirm(true)}>
          Revoke All Sessions
        </Button>
      )}
      <Button variant="outline" onClick={logout}>
        Sign Out
      </Button>
    </Box>
  );

  // ── Fetch launch + committee + dashboard in parallel ────────────────────────

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    Promise.all([
      authFetch(`/launch/${launchId}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load launch (${r.status})`);
        return r.json() as Promise<Launch>;
      }),
      authFetch(`/committee/${launchId}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load committee (${r.status})`);
        return r.json() as Promise<Committee>;
      }),
      authFetch(`/launch/${launchId}/dashboard`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load dashboard (${r.status})`);
        return r.json() as Promise<Dashboard>;
      }),
    ])
      .then(([l, c, d]) => {
        setLaunch({ ...l, status: l.status.toLowerCase() as Launch['status'] });
        setCommittee(c);
        setDashboard(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [launchId, authFetch]);

  // ── SSE live feed ───────────────────────────────────────────────────────────

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
  const { token } = useAuth();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token) return;
    const url = `${API_BASE}/launch/${launchId}/events`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      setSseEvents((prev) => [`${new Date().toLocaleTimeString()}: ${ev.data}`, ...prev.slice(0, 49)]);
    };

    es.onerror = () => {};

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [launchId, token, API_BASE]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const address = operatorAddress!;
  const isCoordinator =
    (committee?.members ?? []).some((m) => m.address === address);
  const isLead = committee?.lead_address === address;

  // Build hint from fetched launch record (same shape, avoids a second fetch)
  const hint: ChainHint | null = launch
    ? {
        chain_id: launch.record.chain_id,
        chain_name: launch.record.chain_name,
        bech32_prefix: launch.record.bech32_prefix,
        denom: launch.record.denom,
      }
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Box display="flex" flexDirection="column" gap="16px">
        {sessionControls}
        <Text color="$textSecondary" fontSize="$sm">Loading launch…</Text>
      </Box>
    );
  }

  if (error || !launch || !committee || !hint) {
    return (
      <Box display="flex" flexDirection="column" gap="16px">
        {sessionControls}
        <Text color="$textDanger" fontSize="$sm">{error ?? 'Failed to load launch.'}</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap="24px">
      {/* ── Header ── */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Text fontSize="28px" fontWeight="600">{launch.record.chain_name}</Text>
          <Text fontSize="$sm" color="$textSecondary" fontFamily="monospace">
            {launch.record.chain_id}
          </Text>
        </Box>
        <Box display="flex" gap="8px" alignItems="center">
          <StatusBadge status={launch.status} />
          {sessionControls}
        </Box>
      </Box>

      {/* ── Metadata card ── */}
      <InfoCard title="Chain Details">
        <InfoRow label="Binary" value={`${launch.record.binary_name} ${launch.record.binary_version}`} />
        <InfoRow label="Denom" value={launch.record.denom} />
        <InfoRow label="Min validators" value={String(launch.record.min_validator_count)} />
        <InfoRow label="Gentx deadline" value={new Date(launch.record.gentx_deadline).toLocaleString()} />
        {launch.record.genesis_time && (
          <InfoRow label="Genesis time" value={new Date(launch.record.genesis_time).toLocaleString()} />
        )}
        <InfoRow label="Type" value={`${launch.launch_type} · ${launch.visibility}`} />
        <InfoRow label="Role" value={isCoordinator ? 'Coordinator' : 'Validator'} />
        {launch.initial_genesis_sha256 && (
          <InfoRow label="Initial genesis SHA-256" value={launch.initial_genesis_sha256} mono />
        )}
        {launch.final_genesis_sha256 && (
          <InfoRow label="Final genesis SHA-256" value={launch.final_genesis_sha256} mono />
        )}
      </InfoCard>

      {/* ── Committee card ── */}
      <InfoCard title={`Committee (${committee.threshold_m}/${committee.total_n})`}>
        {committee.members.map((m) => (
          <InfoRow
            key={m.address}
            label={m.moniker || 'member'}
            value={m.address}
            mono
          />
        ))}
      </InfoCard>

      {/* ── Dashboard card ── */}
      {dashboard && (
        <InfoCard title="Readiness Dashboard">
          <InfoRow label="Approved validators" value={String(dashboard.total_approved)} />
          <InfoRow label="Confirmed ready" value={`${dashboard.confirmed_ready} / ${dashboard.total_approved}`} />
          <InfoRow label="Voting power confirmed" value={`${(dashboard.voting_power_confirmed * 100).toFixed(1)}%`} />
          <InfoRow label="Threshold status" value={dashboard.threshold_status} />
        </InfoCard>
      )}

      {/* ── Role panels ── coordinators see both so they can also participate as validators */}
      {isCoordinator && (
        <CoordinatorPanel
          launchId={launchId}
          hint={hint}
          address={address}
          wallet={wallet!}
          signingChainId={signingChainId}
          launch={launch}
          committee={committee}
          isLead={isLead}
          authFetch={authFetch}
          onLaunchUpdated={(l) => setLaunch({ ...l, status: l.status.toLowerCase() as Launch['status'] })}
          onCommitteeUpdated={setCommittee}
        />
      )}
      <ValidatorPanel
        launchId={launchId}
        hint={hint}
        address={address}
        wallet={wallet!}
        signingChainId={signingChainId}
        launch={launch}
        dashboard={dashboard}
        authFetch={authFetch}
      />

      {/* ── Audit log ── */}
      <AuditLogSection launchId={launchId} authFetch={authFetch} />

      {/* ── Live event feed ── */}
      <InfoCard title="Live Events">
        {sseEvents.length === 0 ? (
          <Text fontSize="$xs" color="$textSecondary">
            Listening for events…
          </Text>
        ) : (
          <Box display="flex" flexDirection="column" gap="4px">
            {sseEvents.map((ev, i) => (
              <Text key={i} fontSize="$xs" color="$textSecondary" fontFamily="monospace">
                {ev}
              </Text>
            ))}
          </Box>
        )}
      </InfoCard>
    </Box>
  );
}

// ── Shared UI primitives ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    open: '$textSuccess',
    genesis_ready: '$textSuccess',
    launched: '$purple600',
    canceled: '$textDanger',
  };
  return (
    <Text
      fontSize="$sm"
      fontWeight="$semibold"
      color={colorMap[status] ?? '$textSecondary'}
    >
      {status.replace(/_/g, ' ').toUpperCase()}
    </Text>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
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

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Box display="flex" gap="8px" alignItems="baseline">
      <Text fontSize="$xs" color="$textSecondary" attributes={{ minWidth: '160px', flexShrink: '0' }}>
        {label}
      </Text>
      <Text fontSize="$sm" fontFamily={mono ? 'monospace' : undefined}>
        {value}
      </Text>
    </Box>
  );
}

// ── Audit log section ─────────────────────────────────────────────────────────

function AuditLogSection({
  launchId,
  authFetch,
}: {
  launchId: string;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [auditRes, pubkeyRes] = await Promise.all([
        authFetch(`/launch/${launchId}/audit`),
        fetch(`${API_BASE}/audit/pubkey`),
      ]);
      if (!auditRes.ok) throw new Error(`audit fetch failed: ${auditRes.status}`);
      const { entries: data } = await auditRes.json() as { entries: AuditEntry[] };
      setEntries(data ?? []);
      if (pubkeyRes.ok) {
        const { public_key } = await pubkeyRes.json() as { public_key: string };
        setPubkey(public_key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <InfoCard title="Audit Log">
      {entries === null ? (
        <Box display="flex" flexDirection="column" gap="8px">
          <Button variant="outline" size="sm" onClick={load} isLoading={loading} disabled={loading}>
            {loading ? 'Loading…' : 'Load Audit Log'}
          </Button>
          {error && <Text fontSize="$xs" color="$textDanger">{error}</Text>}
        </Box>
      ) : (
        <Box display="flex" flexDirection="column" gap="8px">
          {pubkey && (
            <InfoRow label="Server audit pubkey" value={pubkey} mono />
          )}
          {entries.length === 0 ? (
            <Text fontSize="$xs" color="$textSecondary">No audit entries yet.</Text>
          ) : (
            entries.map((e, i) => (
              <Box key={i} display="flex" flexDirection="column" gap="4px">
                <Box
                  display="flex"
                  gap="8px"
                  alignItems="baseline"
                  attributes={{ style: { cursor: 'pointer' }, onClick: () => setExpandedIdx(expandedIdx === i ? null : i) }}
                >
                  <Text fontSize="$xs" color="$textSecondary" attributes={{ minWidth: '160px', flexShrink: '0' }}>
                    {new Date(e.occurred_at).toLocaleString()}
                  </Text>
                  <Text fontSize="$sm">{e.event_name}</Text>
                  <Text fontSize="$xs" color="$textSecondary">{expandedIdx === i ? '▲' : '▼'}</Text>
                </Box>
                {expandedIdx === i && (
                  <Box
                    borderRadius="4px"
                    p="8px"
                    attributes={{ style: { background: 'var(--chakra-colors-gray-50, #f7f7f7)', overflowX: 'auto' } }}
                  >
                    <Text fontSize="$xs" fontFamily="monospace">
                      {JSON.stringify(e.payload, null, 2)}
                    </Text>
                  </Box>
                )}
              </Box>
            ))
          )}
        </Box>
      )}
    </InfoCard>
  );
}

function StepCard({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      borderRadius="8px"
      border="1px solid"
      borderColor="$divider"
      p="32px"
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap="16px"
    >
      <Text fontSize="$md" fontWeight="$semibold">{title}</Text>
      {description && (
        <Text fontSize="$sm" color="$textSecondary" textAlign="center">{description}</Text>
      )}
      {error && <Text fontSize="$sm" color="$textDanger">{error}</Text>}
      {children}
    </Box>
  );
}