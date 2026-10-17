/**
 * N-CoreShift — NCoreIQConnectModal
 *
 * Source ingestion UI for "Connected SAP via N-CoreIQ" access mode.
 *
 * Conceptual flow:
 *   Connection → Package Browse → Object Preview → Scope Selection → Import
 *
 * Security rules:
 *   - Never displays tokens, secrets, passwords, or credentials
 *   - All sensitive data (bearerToken) is held server-side only
 *   - Source code content is not shown in this modal (evidence-first)
 *   - All imports are scoped to the active tenantId/projectId
 */

import React, { useState } from 'react';
import { useAppStore } from '../store/AppStoreContext';

// ── Types ─────────────────────────────────────────────────────────────────

interface ConnectionStatus {
  connected: boolean;
  systemId: string | null;
  client: string | null;
  sapRelease: string | null;
  error: string | null;
  testedAt: string | null;
}

interface PackageEntry {
  package: string;
  parent_package: string | null;
  description: string;
  depth: number;
}

interface ObjectEntry {
  sap_object_type: string;
  friendly_type: string;
  object_name: string;
  package: string;
  description: string;
}

type Step = 'connection' | 'packages' | 'preview' | 'import';

type ImportStatus = 'idle' | 'running' | 'completed' | 'partial' | 'failed';

// ── Styles (inline, consistent with UploadModal) ──────────────────────────

const OV: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1100,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
};
const MD: React.CSSProperties = {
  background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)', borderRadius: '12px',
  padding: '1.75rem', width: '100%', maxWidth: '680px', maxHeight: '90vh',
  overflowY: 'auto', boxShadow: '0 8px 48px rgba(0,0,0,.4)',
};
const INP: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '.45rem .6rem',
  border: '1px solid var(--ncs-border)', borderRadius: '6px',
  background: 'var(--ncs-bg)', color: 'var(--ncs-text)', fontSize: '.88rem',
};
const LBL: React.CSSProperties = {
  display: 'block', fontSize: '.77rem', fontWeight: 600,
  color: 'var(--ncs-muted)', marginBottom: '.25rem',
};
const BTN_PRIMARY: React.CSSProperties = {
  padding: '.5rem 1.25rem', border: 'none', borderRadius: '6px',
  background: '#3b82f6', color: '#fff', cursor: 'pointer',
  fontSize: '.88rem', fontWeight: 600,
};
const BTN_SECONDARY: React.CSSProperties = {
  padding: '.5rem 1.25rem', border: '1px solid var(--ncs-border)',
  borderRadius: '6px', background: 'var(--ncs-bg)', cursor: 'pointer', fontSize: '.88rem',
};

// ── Component ─────────────────────────────────────────────────────────────

export function NCoreIQConnectModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: () => void;
}) {
  const { state } = useAppStore();
  const { projects, activeProjectId } = state;
  const [selProjectId, setSelProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '');

  // ── CSRF token (AppRouter session token for POST operations) ───────────
  // Fetched once per modal session via GET /api/ncoreiq/csrf before the
  // first POST. Cached for subsequent calls. Never exposed in the UI.
  const [_csrfToken, _setCsrfToken] = useState<string | null>(null);
  const _csrfTokenRef = React.useRef<string | null>(null);

  async function _ensureCsrfToken(): Promise<string> {
    if (_csrfTokenRef.current) return _csrfTokenRef.current;
    try {
      const resp = await fetch('/api/ncoreiq/csrf', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': 'Fetch' },
      });
      const token = resp.headers.get('X-CSRF-Token');
      if (!token) {
        // AppRouter may not inject a CSRF token in non-production / local dev.
        // Fall back to empty string so POSTs are not blocked locally.
        return '';
      }
      _csrfTokenRef.current = token;
      _setCsrfToken(token);
      return token;
    } catch {
      // Network failure acquiring CSRF token — surface a safe error.
      throw new Error('Could not acquire CSRF token. Please reload and try again.');
    }
  }

  // ── Step state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('connection');

  // ── Connection step ─────────────────────────────────────────────────────
  const [ncoreiqUrl, setNcoreiqUrl] = useState('');
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);
  const [testingConn, setTestingConn] = useState(false);

  // ── Package step ────────────────────────────────────────────────────────
  const [rootPackage, setRootPackage] = useState('');
  const [packages, setPackages] = useState<PackageEntry[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  // ── Preview step ────────────────────────────────────────────────────────
  const [previewObjects, setPreviewObjects] = useState<ObjectEntry[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Explicit object selection (Gate 0E10-AUTH-R2D-SELECT1).
  // Keyed by "<sap_object_type>::<object_name>" — the stable identity
  // pair already present on every ObjectEntry returned by /preview.
  // IMPORTANT: starts empty on every new preview load (no implicit
  // "select everything" default).
  const [selectedObjectKeys, setSelectedObjectKeys] = useState<Set<string>>(new Set());

  // ── Import step ─────────────────────────────────────────────────────────
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string>('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // ── Connection test ─────────────────────────────────────────────────────

  async function handleTestConnection() {
    if (!ncoreiqUrl.trim()) return;
    setTestingConn(true);
    setConnStatus(null);
    try {
      const csrfToken = await _ensureCsrfToken();
      const resp = await fetch('/api/ncoreiq/ping', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({ baseUrl: ncoreiqUrl.trim() }),
      });
      const json = await resp.json();
      if (resp.ok && json.connected) {
        setConnStatus({
          connected: true,
          systemId: json.systemId ?? null,
          client: json.client ?? null,
          sapRelease: json.sapRelease ?? null,
          error: null,
          testedAt: new Date().toISOString(),
        });
      } else {
        setConnStatus({
          connected: false,
          systemId: null, client: null, sapRelease: null,
          error: json.error ?? 'Connection failed',
          testedAt: new Date().toISOString(),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error — check that N-CoreIQ is reachable';
      setConnStatus({
        connected: false, systemId: null, client: null, sapRelease: null,
        error: msg,
        testedAt: new Date().toISOString(),
      });
    } finally {
      setTestingConn(false);
    }
  }

  // ── Package browsing ────────────────────────────────────────────────────

  async function handleBrowsePackages() {
    if (!rootPackage.trim()) return;
    setLoadingPackages(true);
    setPackageError(null);
    try {
      const csrfToken = await _ensureCsrfToken();
      const resp = await fetch('/api/ncoreiq/packages', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          baseUrl: ncoreiqUrl.trim() || undefined,
          package: rootPackage.trim(),
          include_subpackages: true,
        }),
      });
      const json = await resp.json();
      if (resp.ok && Array.isArray(json.packages)) {
        setPackages(json.packages as PackageEntry[]);
      } else {
        setPackageError(json.error ?? 'Failed to load packages');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error loading packages';
      setPackageError(msg);
    } finally {
      setLoadingPackages(false);
    }
  }

  function togglePackage(pkg: string) {
    setSelectedPackages((prev) =>
      prev.includes(pkg) ? prev.filter((p) => p !== pkg) : [...prev, pkg],
    );
  }

  // ── Object preview ──────────────────────────────────────────────────────

  async function handlePreview() {
    if (!selectedPackages.length) return;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const csrfToken = await _ensureCsrfToken();
      const resp = await fetch('/api/ncoreiq/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          baseUrl: ncoreiqUrl.trim() || undefined,
          packages: selectedPackages,
          include_subpackages: true,
        }),
      });
      const json = await resp.json();
      if (resp.ok && Array.isArray(json.objects)) {
        setPreviewObjects(json.objects as ObjectEntry[]);
        // Selection resets to empty on every new preview load — explicit
        // opt-in only, never an implicit "select everything" default.
        setSelectedObjectKeys(new Set());
        setStep('preview');
      } else {
        setPreviewError(json.error ?? 'Failed to load object preview');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error loading preview';
      setPreviewError(msg);
    } finally {
      setLoadingPreview(false);
    }
  }

  // ── Object selection helpers (Gate 0E10-AUTH-R2D-SELECT1) ───────────────

  function objectKey(obj: ObjectEntry): string {
    return `${obj.sap_object_type}::${obj.object_name}`;
  }

  function toggleObjectSelection(obj: ObjectEntry) {
    const key = objectKey(obj);
    setSelectedObjectKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllObjects() {
    // Select All applies to ALL objects in previewObjects — not just the
    // first 200 rows rendered in the (possibly truncated) list view.
    setSelectedObjectKeys(new Set(previewObjects.map(objectKey)));
  }

  function deselectAllObjects() {
    setSelectedObjectKeys(new Set());
  }

  const selectedCount = selectedObjectKeys.size;

  // ── Import ──────────────────────────────────────────────────────────────

  async function handleStartImport() {
    // Explicit selection is required — the frontend must never issue an
    // empty explicit selection request. Selected count must be >= 1.
    if (!selProjectId || !selectedPackages.length || selectedCount === 0) return;
    setStep('import');
    setImportStatus('running');
    setImportErrors([]);
    setImportMessage('Starting import…');
    try {
      const csrfToken = await _ensureCsrfToken();
      const proj = projects.find((p) => p.id === selProjectId);
      // Build the explicit object selection payload from the stable
      // identity fields already present on each ObjectEntry — the same
      // schema the backend's authoritative preview/search returns.
      const selectedObjects = previewObjects
        .filter((obj) => selectedObjectKeys.has(objectKey(obj)))
        .map((obj) => ({
          sap_object_type: obj.sap_object_type,
          object_name: obj.object_name,
        }));
      const resp = await fetch('/api/ncoreiq/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          projectId: selProjectId,
          projectName: proj?.name,
          baseUrl: ncoreiqUrl.trim() || undefined,
          packages: selectedPackages,
          include_subpackages: true,
          objects: selectedObjects,
        }),
      });
      const json = await resp.json();
      if (resp.ok && json.jobId) {
        setImportJobId(json.jobId);
        setImportMessage(`Import job started (ID: ${json.jobId}). Processing…`);
        // Poll status
        await pollImportStatus(json.jobId);
      } else {
        setImportStatus('failed');
        setImportMessage('Failed to start import job');
        setImportErrors([json.error ?? 'Unknown error']);
      }
    } catch (err: unknown) {
      setImportStatus('failed');
      const msg = err instanceof Error ? err.message : 'Network error starting import';
      setImportMessage(msg);
    }
  }

  async function pollImportStatus(jobId: string) {
    const maxPolls = 60;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const resp = await fetch(`/api/ncoreiq/import/${encodeURIComponent(jobId)}/status`);
        const json = await resp.json();
        const status: string = json.status ?? 'RUNNING';
        setImportMessage(
          `Import status: ${status}` +
            (json.objectsImported != null ? ` — ${json.objectsImported} objects imported` : ''),
        );
        if (status === 'COMPLETED') {
          setImportStatus('completed');
          setImportMessage(
            `Import complete — ${json.objectsImported ?? 0} objects imported successfully.`,
          );
          return;
        }
        if (status === 'PARTIAL') {
          setImportStatus('partial');
          setImportMessage(
            `Import partially complete — ${json.objectsImported ?? 0} succeeded, ${json.objectsFailed ?? 0} failed.`,
          );
          setImportErrors(json.errors ?? []);
          return;
        }
        if (status === 'FAILED' || status === 'CANCELLED') {
          setImportStatus('failed');
          setImportErrors(json.errors ?? ['Import failed']);
          return;
        }
      } catch {
        // Poll failure — continue
      }
    }
    setImportStatus('partial');
    setImportMessage('Import is taking longer than expected. Check job status manually.');
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const stepLabels: Record<Step, string> = {
    connection: '1. Connection',
    packages: '2. Packages',
    preview: '3. Preview',
    import: '4. Import',
  };

  return (
    <div style={OV} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MD} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
              Connected SAP via N-CoreIQ
            </h2>
            <div style={{ fontSize: '.78rem', color: 'var(--ncs-muted)', marginTop: '.2rem' }}>
              {stepLabels[step]}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ncs-muted)' }}>✕</button>
        </div>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem' }}>
          {(['connection', 'packages', 'preview', 'import'] as Step[]).map((s) => (
            <div key={s} style={{
              flex: 1, height: '3px', borderRadius: '2px',
              background: step === s ? '#3b82f6'
                : (['packages', 'preview', 'import'].indexOf(s) <= ['connection', 'packages', 'preview', 'import'].indexOf(step) ? '#60a5fa' : 'var(--ncs-border)'),
            }} />
          ))}
        </div>

        {/* ── Step: Connection ── */}
        {step === 'connection' && (
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={LBL}>Target Project</label>
              {projects.length === 0
                ? <div style={{ fontSize: '.85rem', color: 'var(--ncs-danger)' }}>No projects found.</div>
                : <select style={INP} value={selProjectId} onChange={(e) => setSelProjectId(e.target.value)}>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
              }
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={LBL}>N-CoreIQ Base URL</label>
              <input
                style={INP}
                type="url"
                placeholder="http://localhost:8000"
                value={ncoreiqUrl}
                onChange={(e) => setNcoreiqUrl(e.target.value)}
              />
              <div style={{ fontSize: '.74rem', color: 'var(--ncs-muted)', marginTop: '.3rem' }}>
                Use the direct backend URL. Never use the AppRouter URL for backend integration.
              </div>
            </div>

            {/* Connection status */}
            {connStatus && (
              <div style={{
                padding: '.75rem', borderRadius: '8px', marginBottom: '1rem',
                background: connStatus.connected ? 'rgba(34,197,94,.08)' : 'rgba(220,53,69,.08)',
                border: '1px solid var(--ncs-border)',
              }}>
                <div style={{ fontWeight: 600, fontSize: '.88rem', marginBottom: '.4rem' }}>
                  {connStatus.connected ? '✓ Connected' : '✗ Connection failed'}
                </div>
                {connStatus.connected && (
                  <div style={{ fontSize: '.82rem', color: 'var(--ncs-muted)', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                    {connStatus.systemId && <span>SID: <strong>{connStatus.systemId}</strong></span>}
                    {connStatus.client && <span>Client: <strong>{connStatus.client}</strong></span>}
                    {connStatus.sapRelease && <span>SAP Release: <strong>{connStatus.sapRelease}</strong></span>}
                  </div>
                )}
                {!connStatus.connected && connStatus.error && (
                  <div style={{ fontSize: '.82rem', color: 'var(--ncs-danger)' }}>{connStatus.error}</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={BTN_SECONDARY}>Cancel</button>
              <button onClick={handleTestConnection} disabled={!ncoreiqUrl.trim() || testingConn} style={{ ...BTN_PRIMARY, opacity: (!ncoreiqUrl.trim() || testingConn) ? .5 : 1 }}>
                {testingConn ? 'Testing…' : 'Test Connection'}
              </button>
              {connStatus?.connected && (
                <button onClick={() => setStep('packages')} style={BTN_PRIMARY}>
                  Next: Browse Packages →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step: Packages ── */}
        {step === 'packages' && (
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={LBL}>Root Package</label>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <input style={{ ...INP, flex: 1 }} placeholder="ZNCOREIQ" value={rootPackage} onChange={(e) => setRootPackage(e.target.value)} />
                <button onClick={handleBrowsePackages} disabled={!rootPackage.trim() || loadingPackages} style={{ ...BTN_PRIMARY, opacity: !rootPackage.trim() ? .5 : 1 }}>
                  {loadingPackages ? 'Loading…' : 'Browse'}
                </button>
              </div>
            </div>
            {packageError && <div style={{ fontSize: '.82rem', color: 'var(--ncs-danger)', marginBottom: '.75rem' }}>{packageError}</div>}
            {packages.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={LBL}>Select Packages ({selectedPackages.length} selected)</label>
                <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--ncs-border)', borderRadius: '6px' }}>
                  {packages.map((pkg) => (
                    <label key={pkg.package} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem .75rem', cursor: 'pointer', borderBottom: '1px solid var(--ncs-border)', fontSize: '.85rem' }}>
                      <input type="checkbox" checked={selectedPackages.includes(pkg.package)} onChange={() => togglePackage(pkg.package)} />
                      <div>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{pkg.package}</span>
                        {pkg.description && <span style={{ color: 'var(--ncs-muted)', marginLeft: '.5rem' }}>{pkg.description}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setStep('connection')} style={BTN_SECONDARY}>← Back</button>
              <button onClick={handlePreview} disabled={!selectedPackages.length || loadingPreview} style={{ ...BTN_PRIMARY, opacity: !selectedPackages.length ? .5 : 1 }}>
                {loadingPreview ? 'Loading preview…' : `Preview ${selectedPackages.length} Package(s) →`}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Preview ── */}
        {step === 'preview' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
              <div style={{ fontSize: '.85rem' }}>
                <strong>{previewObjects.length}</strong> objects found in selected packages.
                {previewObjects.length > 200 && (
                  <span style={{ color: 'var(--ncs-muted)' }}> (Showing first 200 of {previewObjects.length} objects)</span>
                )}
              </div>
              <div style={{ fontSize: '.85rem', fontWeight: 600 }}>
                Selected: {selectedCount} of {previewObjects.length}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
              <button onClick={selectAllObjects} style={BTN_SECONDARY} disabled={previewObjects.length === 0}>
                Select All
              </button>
              <button onClick={deselectAllObjects} style={BTN_SECONDARY} disabled={selectedCount === 0}>
                Deselect All
              </button>
            </div>

            {previewError && <div style={{ fontSize: '.82rem', color: 'var(--ncs-danger)', marginBottom: '.75rem' }}>{previewError}</div>}
            <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--ncs-border)', borderRadius: '6px', marginBottom: '1rem' }}>
              {previewObjects.slice(0, 200).map((obj, i) => {
                const key = objectKey(obj);
                const checked = selectedObjectKeys.has(key);
                return (
                  <label
                    key={key || i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem', padding: '.4rem .75rem',
                      borderBottom: '1px solid var(--ncs-border)', fontSize: '.82rem', cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleObjectSelection(obj)}
                      aria-label={`Select ${obj.sap_object_type} ${obj.object_name}`}
                    />
                    <span style={{ fontFamily: 'monospace', color: 'var(--ncs-muted)', width: '3.5rem', flexShrink: 0 }}>{obj.sap_object_type}</span>
                    <span style={{ fontWeight: 600 }}>{obj.object_name}</span>
                    {obj.description && <span style={{ color: 'var(--ncs-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.description}</span>}
                  </label>
                );
              })}
              {previewObjects.length > 200 && (
                <div style={{ padding: '.5rem .75rem', fontSize: '.8rem', color: 'var(--ncs-muted)' }}>
                  … and {previewObjects.length - 200} more objects not shown. Select All applies to all {previewObjects.length} objects, including those not visible here.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setStep('packages')} style={BTN_SECONDARY}>← Back</button>
              <button
                onClick={handleStartImport}
                disabled={selectedCount === 0}
                style={{ ...BTN_PRIMARY, opacity: selectedCount === 0 ? .5 : 1 }}
              >
                Import {selectedCount} Selected Object{selectedCount === 1 ? '' : 's'} →
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Import ── */}
        {step === 'import' && (
          <div>
            <div style={{
              padding: '1rem', borderRadius: '8px', marginBottom: '1rem',
              background: importStatus === 'completed' ? 'rgba(34,197,94,.08)' :
                importStatus === 'failed' ? 'rgba(220,53,69,.08)' :
                importStatus === 'partial' ? 'rgba(251,146,60,.08)' : 'var(--ncs-bg)',
              border: '1px solid var(--ncs-border)',
            }}>
              <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: '.4rem' }}>
                {importStatus === 'running' && '⏳ Importing…'}
                {importStatus === 'completed' && '✓ Import Complete'}
                {importStatus === 'partial' && '⚠ Partial Import'}
                {importStatus === 'failed' && '✗ Import Failed'}
              </div>
              <div style={{ fontSize: '.85rem' }}>{importMessage}</div>
              {importJobId && <div style={{ fontSize: '.75rem', color: 'var(--ncs-muted)', marginTop: '.3rem' }}>Job ID: {importJobId}</div>}
              {importErrors.length > 0 && (
                <ul style={{ margin: '.5rem 0 0', padding: '0 0 0 1.2rem', fontSize: '.8rem', color: 'var(--ncs-danger)' }}>
                  {importErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              {(importStatus === 'completed' || importStatus === 'partial') && (
                <button onClick={() => { onImported?.(); onClose(); }} style={BTN_PRIMARY}>Done</button>
              )}
              {importStatus === 'failed' && (
                <button onClick={() => setStep('packages')} style={BTN_SECONDARY}>← Try Again</button>
              )}
              {importStatus === 'running' && (
                <button onClick={onClose} style={BTN_SECONDARY}>Close (import continues in background)</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
