import { useEffect, useState, useCallback } from 'react';
import { Box, Text } from '@interchain-ui/react';
import { Button } from '@/components';
import { useAuthFetch } from '@/hooks';
import { useAuth } from '@/contexts';
import { PageEnvelope } from '@/types';

interface CoordinatorEntry {
  address: string;
  added_by: string;
  added_at: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { isAuthenticated } = useAuth();
  const { authFetch } = useAuthFetch();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated) { setIsAdmin(false); return; }
    authFetch('/admin/coordinators?page=1&per_page=1')
      .then((r) => setIsAdmin(r.status !== 403))
      .catch(() => setIsAdmin(false));
  }, [isAuthenticated, authFetch]);

  if (!isAuthenticated) {
    return (
      <Box maxWidth="720px" mx="auto" mt="60px">
        <Text fontSize="$sm" color="$textSecondary">
          Sign in to access the admin panel.
        </Text>
      </Box>
    );
  }

  if (isAdmin === null) {
    return (
      <Box maxWidth="720px" mx="auto" mt="60px">
        <Text fontSize="$sm" color="$textSecondary">Checking access…</Text>
      </Box>
    );
  }

  if (!isAdmin) {
    return (
      <Box maxWidth="720px" mx="auto" mt="60px">
        <Text fontSize="$sm" color="$textDanger">
          You are not an admin. Set your address in{' '}
          <Text as="span" fontFamily="monospace" fontSize="$sm">COORD_ADMIN_ADDRESSES</Text>{' '}
          to enable admin access.
        </Text>
      </Box>
    );
  }

  return (
    <Box maxWidth="720px" mx="auto" mt="40px" pb="60px">
      <Text fontSize="28px" fontWeight="600" attributes={{ mb: '32px' }}>
        Admin Panel
      </Text>
      <CoordinatorAllowlistSection />
      <SessionRevocationSection />
    </Box>
  );
}

// ── Coordinator Allowlist ─────────────────────────────────────────────────────

function CoordinatorAllowlistSection() {
  const { authFetch } = useAuthFetch();
  const [entries, setEntries] = useState<CoordinatorEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [newAddress, setNewAddress] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [removingAddr, setRemovingAddr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const r = await authFetch('/admin/coordinators?page=1&per_page=100');
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.message ?? `fetch failed: ${r.status}`);
      }
      const data = await r.json() as PageEnvelope<CoordinatorEntry[]>;
      setEntries(data.items ?? []);
      setTotal(data.total);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    const addr = newAddress.trim();
    if (!addr) return;
    setIsAdding(true);
    setAddError(null);
    try {
      const r = await authFetch('/admin/coordinators', {
        method: 'POST',
        body: JSON.stringify({ address: addr }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.message ?? `request failed: ${r.status}`);
      }
      setNewAddress('');
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(address: string) {
    setRemovingAddr(address);
    try {
      const r = await authFetch(`/admin/coordinators/${encodeURIComponent(address)}`, {
        method: 'DELETE',
      });
      if (!r.ok && r.status !== 404) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.message ?? `request failed: ${r.status}`);
      }
      await load();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingAddr(null);
    }
  }

  return (
    <AdminCard title={`Coordinator Allowlist${total > 0 ? ` (${total})` : ''}`}>
      {fetchError && (
        <Text fontSize="$xs" color="$textDanger" attributes={{ mb: '8px' }}>{fetchError}</Text>
      )}

      {/* Add form */}
      <Box display="flex" gap="8px" alignItems="center" attributes={{ mb: '16px' }}>
        <input
          value={newAddress}
          onChange={(e) => setNewAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="cosmos1… address to add"
          style={inputStyle}
        />
        <Button variant="primary" size="sm" onClick={handleAdd} isLoading={isAdding} disabled={isAdding}>
          Add
        </Button>
      </Box>
      {addError && (
        <Text fontSize="$xs" color="$textDanger" attributes={{ mb: '8px' }}>{addError}</Text>
      )}

      {/* List */}
      {isLoading ? (
        <Text fontSize="$xs" color="$textSecondary">Loading…</Text>
      ) : entries.length === 0 ? (
        <Text fontSize="$xs" color="$textSecondary">No coordinators on the allowlist.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="8px">
          {entries.map((e) => (
            <Box
              key={e.address}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              borderRadius="6px"
              border="1px solid"
              borderColor="$divider"
              px="12px"
              py="8px"
            >
              <Box>
                <Text fontSize="$sm" fontFamily="monospace">{e.address}</Text>
                <Text fontSize="$xs" color="$textSecondary">
                  Added by {e.added_by || '—'}{e.added_at ? ` · ${new Date(e.added_at).toLocaleString()}` : ''}
                </Text>
              </Box>
              <Button
                variant="text"
                size="sm"
                onClick={() => handleRemove(e.address)}
                disabled={removingAddr === e.address}
              >
                {removingAddr === e.address ? '…' : 'Remove'}
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </AdminCard>
  );
}

// ── Session Revocation ────────────────────────────────────────────────────────

function SessionRevocationSection() {
  const { authFetch } = useAuthFetch();
  const [targetAddress, setTargetAddress] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function handleRevoke() {
    const addr = targetAddress.trim();
    if (!addr) return;
    setIsRevoking(true);
    setMessage(null);
    try {
      const r = await authFetch(`/admin/sessions/${encodeURIComponent(addr)}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.message ?? `request failed: ${r.status}`);
      }
      setTargetAddress('');
      setMessage({ text: `Sessions revoked for ${addr}`, isError: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), isError: true });
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <AdminCard title="Session Revocation">
      <Text fontSize="$xs" color="$textSecondary" attributes={{ mb: '12px' }}>
        Revoke all active sessions for an operator address. The user will need to sign in again.
      </Text>
      <Box display="flex" gap="8px" alignItems="center">
        <input
          value={targetAddress}
          onChange={(e) => setTargetAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRevoke(); }}
          placeholder="cosmos1… address to revoke"
          style={inputStyle}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleRevoke}
          isLoading={isRevoking}
          disabled={isRevoking || !targetAddress.trim()}
        >
          Revoke Sessions
        </Button>
      </Box>
      {message && (
        <Text
          fontSize="$xs"
          color={message.isError ? '$textDanger' : '$textSuccess'}
          attributes={{ mt: '8px' }}
        >
          {message.text}
        </Text>
      )}
    </AdminCard>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function AdminCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      borderRadius="8px"
      border="1px solid"
      borderColor="$divider"
      p="20px"
      attributes={{ style: { marginBottom: 20 } }}
    >
      <Text fontSize="$md" fontWeight="$semibold" attributes={{ mb: '16px' }}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--chakra-colors-divider, #e2e8f0)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};