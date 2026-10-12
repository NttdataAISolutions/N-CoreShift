import React, { useState, useEffect, useCallback } from 'react';

const API = '/api';

interface BackendProject { id: number; name: string; }
interface Plan {
  id: number; object_id: number; object_name: string;
  analysis_result_id: number; plan_summary: string;
  approval_status: string; approver: string;
  approved_at: string | null; comments: string; disposition: string;
}

const DISP_COLORS: Record<string, string> = {
  Retire: '#dc3545', Replace: '#f59e0b', Refactor: '#3b82f6',
  Replatform: '#a855f7', 'BTP Extension': '#a855f7', Retain: '#22c55e', Pending: '#6b7280',
};

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: '999px',
      fontSize: '0.72rem', fontWeight: 700,
      background: color + '22', color, border: '1px solid ' + color + '44',
    }}>{label}</span>
  );
}

function ApproveModal({ plan, onClose, onDone }: { plan: Plan; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<'Approved' | 'Rejected'>('Approved');
  const [approver, setApprover] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(API + '/plans/' + plan.id + '/approve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approval_status: decision, approver, comments }),
      });
      if (res.ok) { onDone(); onClose(); }
      else setErr('Failed to update plan');
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--ncs-bg)', border: '1px solid var(--ncs-border)',
    borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.85rem',
    color: 'var(--ncs-text)', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)', borderRadius: '12px', padding: '1.5rem', width: '420px', maxWidth: '90vw' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Review Plan — {plan.object_name}</div>
        <div style={{ fontSize: '0.82rem', marginBottom: '1rem' }}>
          <Pill color={DISP_COLORS[plan.disposition] ?? '#6b7280'} label={plan.disposition || 'Unknown'} />
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Decision</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['Approved', 'Rejected'] as const).map(s => {
              const active = decision === s;
              const col = s === 'Approved' ? '#22c55e' : '#dc3545';
              return (
                <button key={s} onClick={() => setDecision(s)} style={{
                  padding: '0.35rem 0.8rem', borderRadius: '6px', cursor: 'pointer',
                  border: '1px solid ' + (active ? col : 'var(--ncs-border)'),
                  background: active ? col + '22' : 'transparent',
                  color: active ? col : 'var(--ncs-muted)', fontWeight: 600, fontSize: '0.82rem',
                }}>{s}</button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Approver name</label>
          <input value={approver} onChange={e => setApprover(e.target.value)} placeholder="e.g. J. Smith" style={inputStyle} />
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder="Optional review notes..." style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        {err && <div style={{ color: '#dc3545', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="ncs-btn ncs-btn--ghost ncs-btn--sm" onClick={onClose}>Cancel</button>
          <button className="ncs-btn ncs-btn--primary ncs-btn--sm" onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Submit Review'}</button>
        </div>
      </div>
    </div>
  );
}

function PlanCard({ plan, onRefresh, onGenerateArtifact }: { plan: Plan; onRefresh: () => void; onGenerateArtifact: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const statusColor = plan.approval_status === 'Approved' ? '#22c55e' : plan.approval_status === 'Rejected' ? '#dc3545' : '#f59e0b';
  const dispColor = DISP_COLORS[plan.disposition] ?? '#6b7280';

  async function handleDelete() {
    if (!window.confirm('Delete Plan #' + plan.id + '?')) return;
    setDeleting(true);
    try { await fetch(API + '/plans/' + plan.id, { method: 'DELETE' }); onRefresh(); }
    finally { setDeleting(false); }
  }

  return (
    <>
      {showReview && <ApproveModal plan={plan} onClose={() => setShowReview(false)} onDone={onRefresh} />}
      <div style={{ background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', fontFamily: 'monospace' }}>{plan.object_name}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)', marginTop: '0.2rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill color={dispColor} label={plan.disposition || 'Unknown'} />
              {plan.approved_at && <span>· {new Date(plan.approved_at).toLocaleDateString()}</span>}
              {plan.approver && <span>· by {plan.approver}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill color={statusColor} label={plan.approval_status} />
            <button className="ncs-btn ncs-btn--ghost ncs-btn--sm" onClick={() => setExpanded(e => !e)}>{expanded ? 'Hide' : 'View Plan'}</button>
            <button className="ncs-btn ncs-btn--secondary ncs-btn--sm" onClick={() => setShowReview(true)}>Review</button>
            {plan.approval_status === 'Approved' && (
              <button className="ncs-btn ncs-btn--primary ncs-btn--sm" onClick={() => onGenerateArtifact(plan.id)}>⚙ Generate Code</button>
            )}
            <button className="ncs-btn ncs-btn--danger ncs-btn--sm" onClick={handleDelete} disabled={deleting}
              style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem' }}>
              {deleting ? '...' : 'Del'}
            </button>
          </div>
        </div>

        {expanded && (
          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--ncs-border)', paddingTop: '0.75rem' }}>
            {plan.plan_summary
              ? <pre style={{ fontFamily: 'inherit', fontSize: '0.83rem', whiteSpace: 'pre-wrap', color: 'var(--ncs-text)', margin: 0, lineHeight: 1.6 }}>{plan.plan_summary}</pre>
              : <div style={{ color: 'var(--ncs-muted)', fontSize: '0.83rem' }}>No plan summary available.</div>
            }
            {plan.comments && (
              <div style={{
                marginTop: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '6px',
                background: statusColor + '11', border: '1px solid ' + statusColor + '44',
                fontSize: '0.82rem', color: 'var(--ncs-muted)',
              }}>
                <strong>Review notes:</strong> {plan.comments}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function ModernizationPlansPage() {
  const [projects, setProjects] = useState<BackendProject[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('All');
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  useEffect(() => {
    fetch(API + '/projects')
      .then(r => r.json())
      .then(d => {
        const list: BackendProject[] = d.data ?? d ?? [];
        setProjects(list);
        if (list.length > 0) setSelId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const loadPlans = useCallback(() => {
    if (!selId) return;
    setLoading(true);
    fetch(API + '/projects/' + selId + '/plans')
      .then(r => r.json())
      .then(d => setPlans(d.data ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, [selId]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  async function handleGenerateArtifact(planId: number) {
    try {
      const res = await fetch(API + '/plans/' + planId + '/artifacts', { method: 'POST' });
      showToast(res.ok ? 'Code generation started — check Artifacts page' : 'Failed to start code generation');
    } catch { showToast('Network error'); }
  }

  const filtered = filter === 'All' ? plans : plans.filter(p => p.approval_status === filter);
  const approved = plans.filter(p => p.approval_status === 'Approved').length;
  const pending = plans.filter(p => p.approval_status === 'Pending').length;
  const rejected = plans.filter(p => p.approval_status === 'Rejected').length;

  return (
    <div className="ncs-page" style={{ position: 'relative' }}>
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
          background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)',
          borderRadius: 8, padding: '0.65rem 1.1rem', fontSize: '0.85rem',
          fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', color: 'var(--ncs-text)',
        }}>{toast}</div>
      )}

      <div className="ncs-page__header">
        <div>
          <h1 className="ncs-page__title">📋 Modernization Plans</h1>
          <p className="ncs-page__subtitle">Review and approve AI-generated plans · Approved plans unlock code generation</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ncs-muted)' }}>Project:</span>
        <select
          value={selId ?? ''}
          onChange={e => { setSelId(Number(e.target.value)); setFilter('All'); }}
          style={{ background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)', borderRadius: '0.4rem', padding: '0.35rem 0.6rem', fontSize: '0.85rem', color: 'var(--ncs-text)', minWidth: '280px', cursor: 'pointer' }}
        >
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="ncs-btn ncs-btn--ghost ncs-btn--sm" onClick={loadPlans}>&#x21BB; Refresh</button>
      </div>

      {plans.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          {([['Total', plans.length, '#6b7280'], ['Approved', approved, '#22c55e'], ['Pending', pending, '#f59e0b'], ['Rejected', rejected, '#dc3545']] as [string, number, string][]).map(([label, value, color]) => (
            <div key={label} className="ncs-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)' }}>{label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="ncs-filter-bar" style={{ marginBottom: '1rem' }}>
        <div className="ncs-filter-group">
          <label className="ncs-filter-label">Status</label>
          <div className="ncs-filter-chips">
            {['All', 'Pending', 'Approved', 'Rejected'].map(s => (
              <button key={s} className={'ncs-chip' + (filter === s ? ' ncs-chip--active' : '')} onClick={() => setFilter(s)}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div style={{ color: 'var(--ncs-muted)', padding: '2rem', textAlign: 'center' }}>Loading plans...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--ncs-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
          <p style={{ fontWeight: 600, margin: '0 0 0.5rem' }}>No plans found</p>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            {filter !== 'All' ? 'No plans with status: ' + filter : 'Run an analysis and generate a modernization plan to get started.'}
          </p>
        </div>
      )}

      {!loading && filtered.map(plan => (
        <PlanCard key={plan.id} plan={plan} onRefresh={loadPlans} onGenerateArtifact={handleGenerateArtifact} />
      ))}
    </div>
  );
}
