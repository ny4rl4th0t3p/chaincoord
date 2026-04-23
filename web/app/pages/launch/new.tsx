import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Box, Text } from '@interchain-ui/react';
import { useChain } from '@interchain-kit/react';
import { CosmosWallet } from '@interchain-kit/core';
import { Button } from '@/components';
import { useAuth } from '@/contexts';
import { useAuthFetch } from '@/hooks';
import { buildCanonicalActionPayload } from '@/utils/signedAction';

// ── Auth gate ─────────────────────────────────────────────────────────────────

export default function CreateLaunchPage() {
  const { isAuthenticated, chainName } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) router.push('/');
  }, [isAuthenticated, router]);

  if (!isAuthenticated || !chainName) return null;

  return <CreateLaunchForm chainName={chainName} />;
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface MemberInput {
  address: string;
  moniker: string;
  pubKeyB64: string;
}

function CreateLaunchForm({ chainName }: { chainName: string }) {
  const { operatorAddress } = useAuth();
  const { wallet, chain } = useChain(chainName);
  const signingChainId = chain.chainId as string;
  const { authFetch } = useAuthFetch();
  const router = useRouter();

  // ── Chain record ─────────────────────────────────────────────────────────

  const [chainId, setChainId] = useState('');
  const [chainNameVal, setChainNameVal] = useState('');
  const [bech32Prefix, setBech32Prefix] = useState('');
  const [binaryName, setBinaryName] = useState('');
  const [binaryVersion, setBinaryVersion] = useState('');
  const [binarySha256, setBinarySha256] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoCommit, setRepoCommit] = useState('');
  const [denom, setDenom] = useState('');
  const [minSelfDelegation, setMinSelfDelegation] = useState('1');
  const [maxCommissionRate, setMaxCommissionRate] = useState('0.20');
  const [maxCommissionChangeRate, setMaxCommissionChangeRate] = useState('0.01');
  const [gentxDeadline, setGentxDeadline] = useState('');
  const [applicationWindowOpen, setApplicationWindowOpen] = useState('');
  const [genesisTime, setGenesisTime] = useState('');
  const [minValidatorCount, setMinValidatorCount] = useState('4');

  // ── Launch options ────────────────────────────────────────────────────────

  const [launchType, setLaunchType] = useState<'mainnet' | 'testnet' | 'devnet'>('mainnet');
  const [visibility, setVisibility] = useState<'public' | 'allowlist'>('public');
  const [allowlistText, setAllowlistText] = useState('');

  // ── Committee ─────────────────────────────────────────────────────────────

  const [thresholdM, setThresholdM] = useState('1');
  const [totalN, setTotalN] = useState('1');
  const [members, setMembers] = useState<MemberInput[]>([
    { address: operatorAddress ?? '', moniker: '', pubKeyB64: '' },
  ]);

  // ── Submission state ──────────────────────────────────────────────────────

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function localDatetimeToISO(val: string): string {
    if (!val) return '';
    return new Date(val).toISOString();
  }

  function updateMember(idx: number, field: keyof MemberInput, value: string) {
    setMembers((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)),
    );
  }

  function addMember() {
    setMembers((prev) => [...prev, { address: '', moniker: '', pubKeyB64: '' }]);
    setTotalN((n) => String(Number(n) + 1));
  }

  function removeMember(idx: number) {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
    setTotalN((n) => String(Math.max(1, Number(n) - 1)));
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      // Validate required fields before signing
      if (!chainId.trim()) throw new Error('chain_id is required');
      if (!bech32Prefix.trim()) throw new Error('bech32_prefix is required');
      if (!binaryName.trim()) throw new Error('binary_name is required');
      if (!denom.trim()) throw new Error('denom is required');
      if (!gentxDeadline) throw new Error('gentx_deadline is required');
      if (Number(minValidatorCount) < 1) throw new Error('min_validator_count must be at least 1');
      const m = Number(thresholdM);
      const n = Number(totalN);
      if (m < 1 || m > n) throw new Error(`threshold_m must be between 1 and ${n}`);
      if (members.length !== n) throw new Error(`member count (${members.length}) must equal total_n (${n})`);

      // Build committee payload for signing (lead signs over members + thresholds)
      const committeePayload = {
        lead_address: operatorAddress!,
        members: members.map((mb) => ({ address: mb.address, moniker: mb.moniker })),
        threshold_m: m,
        total_n: n,
      };
      const payloadStr = buildCanonicalActionPayload(committeePayload);

      // Get a signer — prefer interchain-kit wallet, fall back to window.keplr
      // (duck-type fallbacks handle multi-copy npm installs where instanceof breaks)
      let stdSig: { pub_key: { value: string }; signature: string };
      if (wallet) {
        const cosmosWallet =
          wallet.getWalletOfType(CosmosWallet) ??
          (wallet.originalWallet as any)?.getWalletByChainType?.('cosmos') ??
          (typeof (wallet.originalWallet as any)?.signArbitrary === 'function'
            ? (wallet.originalWallet as any)
            : null);
        if (!cosmosWallet) throw new Error('No Cosmos wallet found — connect your wallet first');
        stdSig = await cosmosWallet.signArbitrary(signingChainId, operatorAddress!, payloadStr);
      } else if (typeof (window as any).keplr?.signArbitrary === 'function') {
        stdSig = await (window as any).keplr.signArbitrary(signingChainId, operatorAddress!, payloadStr);
      } else {
        throw new Error('No Cosmos wallet found — connect your wallet first');
      }

      const leadPubKeyB64 = stdSig.pub_key.value;
      const creationSignature = stdSig.signature;

      // Build final members with lead pub key filled in
      const finalMembers = members.map((mb, i) =>
        i === 0
          ? { ...mb, pubKeyB64: leadPubKeyB64 }
          : mb,
      );

      // Build request body
      const allowlist =
        visibility === 'allowlist'
          ? allowlistText
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

      const body = {
        record: {
          chain_id: chainId.trim(),
          chain_name: chainNameVal.trim() || chainId.trim(),
          bech32_prefix: bech32Prefix.trim(),
          binary_name: binaryName.trim(),
          binary_version: binaryVersion.trim(),
          binary_sha256: binarySha256.trim(),
          repo_url: repoUrl.trim(),
          repo_commit: repoCommit.trim(),
          denom: denom.trim(),
          min_self_delegation: minSelfDelegation.trim() || '1',
          max_commission_rate: maxCommissionRate.trim() || '0.20',
          max_commission_change_rate: maxCommissionChangeRate.trim() || '0.01',
          gentx_deadline: localDatetimeToISO(gentxDeadline),
          application_window_open: applicationWindowOpen
            ? localDatetimeToISO(applicationWindowOpen)
            : localDatetimeToISO(gentxDeadline),
          ...(genesisTime ? { genesis_time: localDatetimeToISO(genesisTime) } : {}),
          min_validator_count: Number(minValidatorCount),
        },
        launch_type: launchType.toUpperCase(),
        visibility: visibility.toUpperCase(),
        allowlist,
        committee: {
          members: finalMembers.map((mb) => ({
            address: mb.address.trim(),
            moniker: mb.moniker.trim(),
            pub_key_b64: mb.pubKeyB64,
          })),
          threshold_m: m,
          total_n: n,
          lead_address: operatorAddress!,
          creation_signature: creationSignature,
        },
      };

      const res = await authFetch('/launch', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message ?? `request failed: ${res.status}`);
      }

      const launch = await res.json();
      router.push(`/launch/${launch.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box maxWidth="720px" mx="auto" mt="40px" pb="60px">
      <Text fontSize="28px" fontWeight="600" attributes={{ mb: '4px' }}>
        New Launch
      </Text>
      <Text fontSize="$sm" color="$textSecondary" attributes={{ mb: '32px' }}>
        Create a new chain launch and its coordinating committee.
      </Text>

      {/* ── Chain Record ── */}
      <FormSection title="Chain Record">
        <Row>
          <Field label="Chain ID *">
            <TextInput value={chainId} onChange={setChainId} placeholder="mychain-1" />
          </Field>
          <Field label="Chain Name">
            <TextInput value={chainNameVal} onChange={setChainNameVal} placeholder="mychain" />
          </Field>
        </Row>
        <Row>
          <Field label="Bech32 Prefix *">
            <TextInput value={bech32Prefix} onChange={setBech32Prefix} placeholder="cosmos" />
          </Field>
          <Field label="Denom *">
            <TextInput value={denom} onChange={setDenom} placeholder="uatom" />
          </Field>
        </Row>
        <Row>
          <Field label="Binary Name *">
            <TextInput value={binaryName} onChange={setBinaryName} placeholder="gaiad" />
          </Field>
          <Field label="Binary Version">
            <TextInput value={binaryVersion} onChange={setBinaryVersion} placeholder="v17.0.0" />
          </Field>
        </Row>
        <Row>
          <Field label="Binary SHA-256">
            <TextInput value={binarySha256} onChange={setBinarySha256} placeholder="abc123…" />
          </Field>
          <Field label="Min Validators *">
            <TextInput
              value={minValidatorCount}
              onChange={setMinValidatorCount}
              placeholder="4"
              type="number"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Gentx Deadline *">
            <TextInput
              value={gentxDeadline}
              onChange={setGentxDeadline}
              type="datetime-local"
            />
          </Field>
          <Field label="Application Window Open">
            <TextInput
              value={applicationWindowOpen}
              onChange={setApplicationWindowOpen}
              type="datetime-local"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Genesis Time (optional)">
            <TextInput
              value={genesisTime}
              onChange={setGenesisTime}
              type="datetime-local"
            />
          </Field>
          <Field label="Min Self Delegation">
            <TextInput value={minSelfDelegation} onChange={setMinSelfDelegation} placeholder="1" />
          </Field>
        </Row>
        <Row>
          <Field label="Max Commission Rate">
            <TextInput
              value={maxCommissionRate}
              onChange={setMaxCommissionRate}
              placeholder="0.20"
            />
          </Field>
          <Field label="Max Commission Change Rate">
            <TextInput
              value={maxCommissionChangeRate}
              onChange={setMaxCommissionChangeRate}
              placeholder="0.01"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Repo URL">
            <TextInput value={repoUrl} onChange={setRepoUrl} placeholder="https://github.com/…" />
          </Field>
          <Field label="Repo Commit">
            <TextInput value={repoCommit} onChange={setRepoCommit} placeholder="abc1234" />
          </Field>
        </Row>
      </FormSection>

      {/* ── Launch Options ── */}
      <FormSection title="Launch Options">
        <Field label="Launch Type">
          <Box display="flex" gap="16px">
            {(['mainnet', 'testnet', 'devnet'] as const).map((t) => (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="launchType"
                  value={t}
                  checked={launchType === t}
                  onChange={() => setLaunchType(t)}
                />
                <Text fontSize="$sm">{t}</Text>
              </label>
            ))}
          </Box>
        </Field>
        <Field label="Visibility">
          <Box display="flex" gap="16px">
            {(['public', 'allowlist'] as const).map((v) => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                />
                <Text fontSize="$sm">{v}</Text>
              </label>
            ))}
          </Box>
        </Field>
        {visibility === 'allowlist' && (
          <Field label="Initial Allowlist (one address per line or comma-separated)">
            <textarea
              value={allowlistText}
              onChange={(e) => setAllowlistText(e.target.value)}
              rows={4}
              placeholder="cosmos1abc…&#10;cosmos1def…"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--chakra-colors-divider, #e2e8f0)',
                background: 'transparent',
                color: 'inherit',
                fontSize: 14,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </Field>
        )}
      </FormSection>

      {/* ── Committee ── */}
      <FormSection title="Committee">
        <Row>
          <Field label="Threshold M *">
            <TextInput value={thresholdM} onChange={setThresholdM} placeholder="1" type="number" />
          </Field>
          <Field label="Total N *">
            <TextInput
              value={totalN}
              onChange={(v) => {
                setTotalN(v);
                const n = Number(v);
                if (members.length < n) {
                  setMembers((prev) => [
                    ...prev,
                    ...Array(n - prev.length)
                      .fill(null)
                      .map(() => ({ address: '', moniker: '', pubKeyB64: '' })),
                  ]);
                } else if (members.length > n && n >= 1) {
                  setMembers((prev) => prev.slice(0, n));
                }
              }}
              placeholder="1"
              type="number"
            />
          </Field>
        </Row>

        <Text fontSize="$xs" color="$textSecondary" attributes={{ mb: '8px' }}>
          Members — your address (lead) is pre-filled. The public key is captured automatically when you submit.
        </Text>

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
            attributes={{ style: { marginBottom: 8 } }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Text fontSize="$xs" color="$textSecondary">
                {idx === 0 ? 'Lead (you)' : `Member ${idx + 1}`}
              </Text>
              {idx > 0 && (
                <Button variant="text" size="sm" onClick={() => removeMember(idx)}>
                  Remove
                </Button>
              )}
            </Box>
            <TextInput
              value={mb.address}
              onChange={(v) => updateMember(idx, 'address', v)}
              placeholder="cosmos1…"
              disabled={idx === 0}
            />
            <TextInput
              value={mb.moniker}
              onChange={(v) => updateMember(idx, 'moniker', v)}
              placeholder="Moniker (optional)"
            />
            {idx > 0 && (
              <TextInput
                value={mb.pubKeyB64}
                onChange={(v) => updateMember(idx, 'pubKeyB64', v)}
                placeholder="Public key (base64, optional)"
              />
            )}
          </Box>
        ))}

        <Button variant="outline" size="sm" onClick={addMember}>
          + Add Member
        </Button>
      </FormSection>

      {/* ── Submit ── */}
      {submitError && (
        <Text fontSize="$sm" color="$textDanger" attributes={{ mb: '12px' }}>
          {submitError}
        </Text>
      )}
      <Box display="flex" gap="12px">
        <Button
          variant="primary"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating…' : 'Create Launch'}
        </Button>
        <Button variant="outline" onClick={() => router.push('/')} disabled={isSubmitting}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}

// ── Local UI primitives ────────────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
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
      <Box display="flex" flexDirection="column" gap="12px">
        {children}
      </Box>
    </Box>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <Box display="flex" gap="12px" flexWrap="wrap">
      {children}
    </Box>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="4px" attributes={{ style: { flex: '1 1 200px' } }}>
      <Text fontSize="$xs" color="$textSecondary">{label}</Text>
      {children}
    </Box>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 6,
        border: '1px solid var(--chakra-colors-divider, #e2e8f0)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 14,
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}