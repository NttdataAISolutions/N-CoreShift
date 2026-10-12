import React, { useEffect, useState, useCallback } from 'react';

// ── Types (mirror srv/src/ai-admin/types.ts – no shared package needed) ───

type ProviderId = 'sap-ai-core' | 'sap-ai-interface' | 'openai';

interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  isConfigured: boolean;
  isActive: boolean;
  model?: string;
  endpointHint?: string;
}

interface ConnectionTestResult {
  providerId: ProviderId;
  success: boolean;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  providerId: ProviderId;
  detail: string;
  outcome: 'SUCCESS' | 'FAILURE';
}

// ── API base ───────────────────────────────────────────────────────────────

const API = '/api/ai-admin';

async function apiFetch<T>(path: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Small UI helpers ───────────────────────────────────────────────────────

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: ok ? '#d4edda' : '#f8d7da',
        color: ok ? '#155724' : '#721c24',
      }}
    >
      {label}
    </span>
  );
}

function Spinner() {
  return <span style={{ fontSize: 12, color: '#888' }}>⟳ loading…</span>;
}

// ── Provider card ──────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  onActivate,
  onTest,
  testResult,
  testing,
  activating,
}: {
  provider: ProviderInfo;
  onActivate: (id: ProviderId) => void;
  onTest: (id: ProviderId) => void;
  testResult?: ConnectionTestResult;
  testing: boolean;
  activating: boolean;
}) {
  return (
    <div
      style={{
        border: provider.isActive ? '2px solid #0070f3' : '1px solid #dee2e6',
        borderRadius: 8,
        padding: '16px 20px',
        marginBottom: 12,
        background: provider.isActive ? '#f0f7ff' : '#fff',
        position: 'relative',
      }}
    >
      {provider.isActive && (
        <span
          style={{
            position: 'absolute',
            top: 10,
            right: 14,
            fontSize: 11,
            fontWeight: 700,
            color: '#0070f3',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          ★ Active
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <strong style={{ fontSize: 15 }}>{provider.name}</strong>
        <Badge ok={provider.isConfigured} label={provider.isConfigured ? 'Configured' : 'Not configured'} />
      </div>
      <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#555' }}>{provider.description}</p>
      {provider.model && (
        <div style={{ fontSize: 12, color: '#777', marginBottom: 4 }}>
          Model: <code>{provider.model}</code>
        </div>
      )}
      {provider.endpointHint && (
        <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
          Endpoint: <code>{provider.endpointHint}</code>
        </div>
      )}

      {testResult && (
        <div
          style={{
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 6,
            marginBottom: 8,
            background: testResult.success ? '#d4edda' : '#f8d7da',
            color: testResult.success ? '#155724' : '#721c24',
          }}
        >
          {testResult.success
            ? `✓ Connected – ${testResult.latencyMs} ms (${testResult.checkedAt})`
            : `✗ Failed – ${testResult.error}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onTest(provider.id)}
          disabled={testing || !provider.isConfigured}
          style={{
            fontSize: 12,
            padding: '4px 14px',
            borderRadius: 4,
            border: '1px solid #ccc',
            cursor: testing || !provider.isConfigured ? 'not-allowed' : 'pointer',
            background: '#f8f9fa',
          }}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {!provider.isActive && (
          <button
            onClick={() => onActivate(provider.id)}
            disabled={activating}
            style={{
              fontSize: 12,
              padding: '4px 14px',
              borderRadius: 4,
              border: 'none',
              cursor: activating ? 'not-allowed' : 'pointer',
              background: '#0070f3',
              color: '#fff',
            }}
          >
            {activating ? 'Activating…' : 'Set as Active'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Audit log table ────────────────────────────────────────────────────────

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0)
    return <p style={{ color: '#888', fontSize: 13 }}>No audit entries yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f1f3f5', textAlign: 'left' }}>
            {['Time', 'Action', 'Provider', 'Actor', 'Detail', 'Outcome'].map((h) => (
              <th key={h} style={{ padding: '6px 10px', borderBottom: '1px solid #dee2e6' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                {new Date(e.timestamp).toLocaleTimeString()}
              </td>
              <td style={{ padding: '5px 10px' }}>{e.action}</td>
              <td style={{ padding: '5px 10px' }}>{e.providerId}</td>
              <td style={{ padding: '5px 10px' }}>{e.actor}</td>
              <td style={{ padding: '5px 10px' }}>{e.detail}</td>
              <td style={{ padding: '5px 10px' }}>
                <Badge ok={e.outcome === 'SUCCESS'} label={e.outcome} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdministrationPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Per-provider state for test results / spinners
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [activating, setActivating] = useState<Record<string, boolean>>({});

  const [activeTab, setActiveTab] = useState<'providers' | 'audit'>('providers');

  // ── Fetch providers ──────────────────────────────────────────────────────
  const loadProviders = useCallback(async () => {
    try {
      const data = await apiFetch<{ providers: ProviderInfo[]; activeProvider: ProviderId | null }>(
        '/providers',
      );
      setProviders(data.providers);
      setActiveProvider(data.activeProvider);
      setApiError(null);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch audit log ──────────────────────────────────────────────────────
  const loadAudit = useCallback(async () => {
    try {
      const data = await apiFetch<{ entries: AuditEntry[] }>('/audit?limit=50');
      setAuditEntries(data.entries);
    } catch {
      // audit is non-critical – swallow silently
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void loadAudit();
  }, [loadProviders, loadAudit]);

  // ── Test connection ──────────────────────────────────────────────────────
  const handleTest = useCallback(
    async (id: ProviderId) => {
      setTesting((t) => ({ ...t, [id]: true }));
      try {
        const result = await apiFetch<ConnectionTestResult>(`/providers/${id}/test`, {
          method: 'POST',
        });
        setTestResults((r) => ({ ...r, [id]: result }));
        void loadAudit();
      } catch (err) {
        setTestResults((r) => ({
          ...r,
          [id]: {
            providerId: id,
            success: false,
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      } finally {
        setTesting((t) => ({ ...t, [id]: false }));
      }
    },
    [loadAudit],
  );

  // ── Set active provider ──────────────────────────────────────────────────
  const handleActivate = useCallback(
    async (id: ProviderId) => {
      setActivating((a) => ({ ...a, [id]: true }));
      try {
        await apiFetch('/active-provider', {
          method: 'POST',
          body: JSON.stringify({ providerId: id }),
        });
        setActiveProvider(id);
        setProviders((prev) => prev.map((p) => ({ ...p, isActive: p.id === id })));
        void loadAudit();
      } catch (err) {
        setApiError(err instanceof Error ? err.message : String(err));
      } finally {
        setActivating((a) => ({ ...a, [id]: false }));
      }
    },
    [loadAudit],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 40px', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🔧 Administration</h1>
        <p style={{ color: '#666', fontSize: 14, marginTop: 4 }}>
          AI/LLM provider management · Platform Administrators only
        </p>
      </div>

      {/* API unreachable banner */}
      {apiError && (
        <div
          style={{
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: 6,
            padding: '10px 16px',
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <strong>⚠ API server unreachable</strong> – start it with{' '}
          <code>cd srv && npm run api</code> then refresh.
          <br />
          <span style={{ color: '#888' }}>{apiError}</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #dee2e6', marginBottom: 20 }}>
        {(['providers', 'audit'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab === 'audit') void loadAudit();
            }}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: activeTab === tab ? 700 : 400,
              border: 'none',
              borderBottom: activeTab === tab ? '3px solid #0070f3' : '3px solid transparent',
              background: 'none',
              cursor: 'pointer',
              color: activeTab === tab ? '#0070f3' : '#555',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'providers' ? '🤖 AI Providers' : '📋 Audit Log'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#888' }}>
            Active: <strong>{activeProvider ?? 'none'}</strong>
          </span>
          <button
            onClick={() => {
              void loadProviders();
              void loadAudit();
            }}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid #ccc',
              background: '#f8f9fa',
              cursor: 'pointer',
            }}
          >
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Providers tab */}
      {activeTab === 'providers' && (
        <div>
          {loading ? (
            <Spinner />
          ) : providers.length === 0 && !apiError ? (
            <p style={{ color: '#888' }}>No providers registered.</p>
          ) : (
            providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                onActivate={(id) => void handleActivate(id)}
                onTest={(id) => void handleTest(id)}
                testResult={testResults[p.id]}
                testing={!!testing[p.id]}
                activating={!!activating[p.id]}
              />
            ))
          )}
        </div>
      )}

      {/* Audit tab */}
      {activeTab === 'audit' && (
        <div>
          <AuditTable entries={auditEntries} />
        </div>
      )}
    </div>
  );
}
