import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Text } from '@interchain-ui/react';
import { Button } from '@/components';
import { useAuthFetch } from '@/hooks';
import { useAuth } from '@/contexts';
import { Launch, PageEnvelope } from '@/types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  window_closed: 'Window Closed',
  genesis_ready: 'Genesis Ready',
  launched: 'Launched',
  canceled: 'Canceled',
};

const STATUS_COLOR: Record<string, string> = {
  draft: '$textSecondary',
  open: '$textSuccess',
  window_closed: '$text',
  genesis_ready: '$textSuccess',
  launched: '$purple600',
  canceled: '$textDanger',
};

export default function LaunchList() {
  const { authFetch } = useAuthFetch();
  const { isAuthenticated, isCoordinator } = useAuth();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const perPage = 20;

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    authFetch(`/launches?page=${page}&per_page=${perPage}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `fetch failed: ${res.status}`);
        }
        return res.json() as Promise<PageEnvelope<Launch[]>>;
      })
      .then((data) => {
        setLaunches(data.items ?? []);
        setTotal(data.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [page, authFetch]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <Box maxWidth="900px" mx="auto" mt="40px">
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" attributes={{ mb: '8px' }}>
        <Text fontSize="28px" fontWeight="600">
          Chain Launches
        </Text>
        {isAuthenticated && isCoordinator && (
          <Link href="/launch/new">
            <Button variant="primary" size="sm">New Launch</Button>
          </Link>
        )}
      </Box>
      <Text fontSize="$sm" color="$textSecondary" attributes={{ mb: '32px' }}>
        {total > 0 ? `${total} launch${total === 1 ? '' : 'es'}` : ''}
      </Text>

      {isLoading && (
        <Text color="$textSecondary" fontSize="$sm">
          Loading…
        </Text>
      )}

      {error && (
        <Text color="$textDanger" fontSize="$sm">
          {error}
        </Text>
      )}

      {!isLoading && !error && launches.length === 0 && (
        <Box
          borderRadius="8px"
          border="1px solid"
          borderColor="$divider"
          p="32px"
          textAlign="center"
        >
          <Text color="$textSecondary" fontSize="$sm">
            No launches yet.
          </Text>
        </Box>
      )}

      {launches.length > 0 && (
        <Box
          borderRadius="8px"
          border="1px solid"
          borderColor="$divider"
          overflow="hidden"
        >
          {/* Header row */}
          <Box
            display="grid"
            attributes={{
              style: {
                gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr',
                borderBottom: '1px solid var(--interchain-divider)',
              },
            }}
            px="16px"
            py="10px"
            backgroundColor="$cardBg"
            borderColor="$divider"
          >
            {['Chain', 'Chain ID', 'Type', 'Status', 'Visibility'].map((h) => (
              <Text key={h} fontSize="$xs" fontWeight="$semibold" color="$textSecondary">
                {h}
              </Text>
            ))}
          </Box>

          {/* Data rows */}
          {launches.map((l, i) => (
            <Link key={l.id} href={`/launch/${l.id}`}>
              <Box
                display="grid"
                attributes={{
                  style: {
                    gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr',
                    borderBottom: i < launches.length - 1 ? '1px solid var(--interchain-divider)' : undefined,
                  },
                }}
                px="16px"
                py="14px"
                borderColor="$divider"
                backgroundColor={{ hover: '$cardBg', base: 'transparent' }}
                cursor="pointer"
              >
                <Box>
                  <Text fontSize="$sm" fontWeight="$medium">
                    {l.record.chain_name}
                  </Text>
                  <Text fontSize="$xs" color="$textSecondary">
                    {l.record.denom}
                  </Text>
                </Box>
                <Text fontSize="$sm" color="$textSecondary" fontFamily="monospace">
                  {l.record.chain_id}
                </Text>
                <Text fontSize="$sm" color="$textSecondary">
                  {l.launch_type}
                </Text>
                <Text
                  fontSize="$sm"
                  fontWeight="$medium"
                  color={STATUS_COLOR[l.status] ?? '$text'}
                >
                  {STATUS_LABEL[l.status] ?? l.status}
                </Text>
                <Text fontSize="$sm" color="$textSecondary">
                  {l.visibility}
                </Text>
              </Box>
            </Link>
          ))}
        </Box>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Box display="flex" justifyContent="center" gap="8px" mt="24px">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ padding: '6px 14px', cursor: page <= 1 ? 'default' : 'pointer' }}
          >
            ← Prev
          </button>
          <Text fontSize="$sm" color="$textSecondary" attributes={{ lineHeight: '32px' }}>
            {page} / {totalPages}
          </Text>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{ padding: '6px 14px', cursor: page >= totalPages ? 'default' : 'pointer' }}
          >
            Next →
          </button>
        </Box>
      )}
    </Box>
  );
}