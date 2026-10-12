import React, { useState } from 'react';
import { useAppStore } from '../store/AppStoreContext';
import type { MockLandscape, MockProject } from '../data/mockData';
import {
  KV, CHECK_BADGE, CHECK_ICON, iStyle,
  SourceModal, TargetModal, StrategyModal, GovernanceModal,
} from './LandscapeModals';
import type { SourceDraft, TargetDraft, StrategyDraft, GovDraft } from './LandscapeModals';

function ProjSelect({ projects, selectedId, onChange }: { projects: MockProject[]; selectedId: string; onChange: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ncs-muted)' }}>Project:</span>
      <select value={selectedId} onChange={e => onChange(e.target.value)} style={{ ...iStyle, minWidth: '280px', cursor: 'pointer' }}>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}

export default function LandscapePage() {
  const { state, updateLandscape, resolveCheck, setActiveProject } = useAppStore();
  const { projects, landscapes } = state;
  const [selId, setSelId] = useState<string>(state.activeProjectId ?? projects[0]?.id ?? '');
  const ls: MockLandscape | undefined = landscapes.find(l => l.projectId === selId);
  const [tab, setTab] = useState<'overview' | 'checks' | 'governance' | 'history'>('overview');
  const [modal, setModal] = useState<'source' | 'target' | 'strategy' | 'governance' | null>(null);
  const [dSrc, setDSrc] = useState<SourceDraft>({ name: '', release: '', edition: '', dbPlatform: '', instanceId: '' });
  const [dTgt, setDTgt] = useState<TargetDraft>({ edition: '', release: '', deploymentModel: '', extensibilityTier: '' });
  const [dStr, setDStr] = useState<StrategyDraft>({ posture: 'Compliant', allowedExtensions: [], retireThreshold: 0 });
  const [dGov, setDGov] = useState<GovDraft>({ approverRoles: [], requiresDualApproval: false, policyVersion: '' });
  const [rolesText, setRolesText] = useState('');
  const [extText, setExtText] = useState('');

  if (!ls) {
    return (
      <div className="ncs-page">
        <div className="ncs-page__header"><h1 className="ncs-page__title">🗺️ Landscape Profile</h1></div>
        <ProjSelect projects={projects} selectedId={selId} onChange={setSelId} />
        <p style={{ color: 'var(--ncs-muted)', marginTop: '2rem' }}>No landscape profile for this project yet.</p>
      </div>
    );
  }

  const passCount = ls.readinessChecks.filter(c => c.status === 'pass').length;
  const total = ls.readinessChecks.length;
  const allPass = passCount === total;
  const hasFail = ls.readinessChecks.some(c => c.status === 'fail' || c.status === 'warn');
  const readyLabel = allPass ? 'Ready' : hasFail ? 'Incomplete' : 'Not Started';
  const readyCls = allPass ? 'success' : hasFail ? 'warning' : 'not-started';

  function open(section: typeof modal) {
    setDSrc({ ...ls!.sourceSystem });
    setDTgt({ ...ls!.targetSystem });
    setDStr({ ...ls!.cleanCoreStrategy, allowedExtensions: [...ls!.cleanCoreStrategy.allowedExtensions] });
    setDGov({ ...ls!.governance, approverRoles: [...ls!.governance.approverRoles] });
    setRolesText(ls!.governance.approverRoles.join(', '));
    setExtText(ls!.cleanCoreStrategy.allowedExtensions.join(', '));
    setModal(section);
  }

  function saveSrc() { updateLandscape({ ...ls!, sourceSystem: dSrc }); setModal(null); }
  function saveTgt() { updateLandscape({ ...ls!, targetSystem: dTgt }); setModal(null); }
  function saveStr() {
    const exts = extText.split(',').map(s => s.trim()).filter(Boolean);
    updateLandscape({ ...ls!, cleanCoreStrategy: { ...dStr, allowedExtensions: exts } });
    setModal(null);
  }
  function saveGov() {
    const roles = rolesText.split(',').map(s => s.trim()).filter(Boolean);
    const m = ls!.governance.policyVersion.match(/^v(\d+)\.(\d+)$/);
    const auto = m ? `v${m[1]}.${parseInt(m[2]) + 1}` : ls!.governance.policyVersion;
    const ver = dGov.policyVersion || auto;
    updateLandscape({
      ...ls!,
      governance: { ...dGov, approverRoles: roles, policyVersion: ver },
      versions: [{ version: ver, changedBy: 'You', changedAt: new Date().toISOString(), summary: 'Governance updated' }, ...ls!.versions],
    });
    setModal(null);
  }

  const tabs = [
    { id: 'overview' as const, label: '📋 Overview' },
    { id: 'checks' as const, label: '✔️ Readiness Checks' },
    { id: 'governance' as const, label: '🔒 Governance' },
    { id: 'history' as const, label: '📜 History' },
  ];

  return (
    <div className="ncs-page">
      {/* Header */}
      <div className="ncs-page__header">
        <div>
          <h1 className="ncs-page__title">🗺️ Landscape Profile</h1>
          <p className="ncs-page__subtitle">Source ↔ Target system configuration and readiness</p>
        </div>
      </div>

      <ProjSelect projects={projects} selectedId={selId} onChange={(id: string) => { setSelId(id); setActiveProject(id); setTab('overview'); }} />

      {/* Readiness banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.1rem',
        borderRadius: '0.6rem', marginBottom: '1.25rem',
        background: allPass ? 'rgba(16,185,129,0.08)' : hasFail ? 'rgba(245,158,11,0.08)' : 'var(--ncs-surface)',
        border: `1px solid ${allPass ? 'var(--ncs-success)' : hasFail ? 'var(--ncs-warning)' : 'var(--ncs-border)'}`,
      }}>
        <span style={{ fontSize: '1.4rem' }}>{allPass ? '✅' : hasFail ? '⚠️' : '🔄'}</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            Landscape Readiness: <span className={`ncs-badge ncs-badge--${readyCls}`}>{readyLabel}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--ncs-muted)', marginTop: '0.15rem' }}>
            {passCount}/{total} checks passed · Policy {ls.governance.policyVersion}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="ncs-tabs" style={{ marginBottom: '1.5rem' }}>
        {tabs.map(t => (
          <button key={t.id} className={`ncs-tab${tab === t.id ? ' ncs-tab--active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="ncs-grid ncs-grid--2" style={{ gap: '1.5rem' }}>
          <div className="ncs-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700 }}>🏭 Source System</span>
              <button className="ncs-btn ncs-btn--ghost" style={{ fontSize: '0.78rem' }} onClick={() => open('source')}>✏️ Edit</button>
            </div>
            <KV pairs={[
              ['Name', ls.sourceSystem.name],
              ['Release', ls.sourceSystem.release],
              ['Edition', ls.sourceSystem.edition],
              ['Database', ls.sourceSystem.dbPlatform],
              ['Instance', <code key="i" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{ls.sourceSystem.instanceId}</code>],
            ]} />
          </div>

          <div className="ncs-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700 }}>🎯 Target System</span>
              <button className="ncs-btn ncs-btn--ghost" style={{ fontSize: '0.78rem' }} onClick={() => open('target')}>✏️ Edit</button>
            </div>
            <KV pairs={[
              ['Edition', ls.targetSystem.edition],
              ['Release', ls.targetSystem.release],
              ['Deployment', ls.targetSystem.deploymentModel],
              ['Extensibility', ls.targetSystem.extensibilityTier],
            ]} />
          </div>

          <div className="ncs-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700 }}>🧹 Clean Core Strategy</span>
              <button className="ncs-btn ncs-btn--ghost" style={{ fontSize: '0.78rem' }} onClick={() => open('strategy')}>✏️ Edit</button>
            </div>
            <KV pairs={[
              ['Posture', <span key="p" className={`ncs-badge ncs-badge--${ls.cleanCoreStrategy.posture === 'Compliant' ? 'success' : ls.cleanCoreStrategy.posture === 'Tolerated' ? 'warning' : 'neutral'}`}>{ls.cleanCoreStrategy.posture}</span>],
              ['Retire Threshold', `${ls.cleanCoreStrategy.retireThreshold}%`],
              ['Allowed Extensions', ls.cleanCoreStrategy.allowedExtensions.length === 0 ? 'None' : ls.cleanCoreStrategy.allowedExtensions.join(', ')],
            ]} />
          </div>

          <div className="ncs-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700 }}>🔒 Governance Summary</span>
              <button className="ncs-btn ncs-btn--ghost" style={{ fontSize: '0.78rem' }} onClick={() => open('governance')}>✏️ Edit</button>
            </div>
            <KV pairs={[
              ['Policy Version', ls.governance.policyVersion],
              ['Approvers', ls.governance.approverRoles.join(', ') || 'None'],
              ['Dual Approval', ls.governance.requiresDualApproval ? 'Required' : 'Not required'],
            ]} />
          </div>
        </div>
      )}

      {/* ── READINESS CHECKS ── */}
      {tab === 'checks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {ls.readinessChecks.map(chk => (
            <div key={chk.id} className="ncs-card" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <span style={{ fontSize: '1.3rem', lineHeight: 1 }}>{CHECK_ICON[chk.status] ?? '❓'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{chk.label}</span>
                  <span className={`ncs-badge ncs-badge--${CHECK_BADGE[chk.status] ?? 'neutral'}`}>{chk.status}</span>
                </div>
                {chk.detail && <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ncs-muted)' }}>{chk.detail}</p>}
              </div>
              {chk.status !== 'pass' && (
                <button className="ncs-btn ncs-btn--secondary" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }} onClick={() => resolveCheck(ls.projectId, chk.id)}>
                  Mark Resolved
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── GOVERNANCE ── */}
      {tab === 'governance' && (
        <div className="ncs-card" style={{ maxWidth: '600px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>🔒 Governance Policy</h3>
            <button className="ncs-btn ncs-btn--secondary" style={{ fontSize: '0.82rem' }} onClick={() => open('governance')}>✏️ Edit Policy</button>
          </div>
          <KV pairs={[
            ['Policy Version', ls.governance.policyVersion],
            ['Approver Roles', ls.governance.approverRoles.length ? ls.governance.approverRoles.join(', ') : <em key="na" style={{ color: 'var(--ncs-muted)' }}>None defined</em>],
            ['Dual Approval', ls.governance.requiresDualApproval
              ? <span key="yes" className="ncs-badge ncs-badge--warning">Required</span>
              : <span key="no" className="ncs-badge ncs-badge--neutral">Not required</span>],
          ]} />
          <div style={{ marginTop: '1.25rem', padding: '0.85rem', borderRadius: '0.5rem', background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ncs-muted)', marginBottom: '0.35rem' }}>CLEAN CORE POSTURE</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>
              {ls.cleanCoreStrategy.posture}
              {ls.cleanCoreStrategy.posture === 'Compliant' && ' — Strictly SAP-standard, no custom code'}
              {ls.cleanCoreStrategy.posture === 'Tolerated' && ' — Reviewed custom code permitted'}
              {ls.cleanCoreStrategy.posture === 'Custom' && ' — Custom policy applied'}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ── */}
      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {ls.versions.length === 0 && (
            <p style={{ color: 'var(--ncs-muted)' }}>No version history yet.</p>
          )}
          {ls.versions.map((v, i) => (
            <div key={i} className="ncs-card" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ minWidth: '2.5rem', textAlign: 'center', padding: '0.3rem 0.5rem', borderRadius: '0.35rem', background: 'var(--ncs-surface)', fontSize: '0.8rem', fontWeight: 700, border: '1px solid var(--ncs-border)' }}>
                {v.version}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{v.summary}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)', marginTop: '0.15rem' }}>
                  {v.changedBy} · {new Date(v.changedAt).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MODALS ── */}
      {modal === 'source' && <SourceModal draft={dSrc} set={setDSrc} onClose={() => setModal(null)} onSave={saveSrc} />}
      {modal === 'target' && <TargetModal draft={dTgt} set={setDTgt} onClose={() => setModal(null)} onSave={saveTgt} />}
      {modal === 'strategy' && <StrategyModal draft={dStr} set={setDStr} extText={extText} setExtText={setExtText} onClose={() => setModal(null)} onSave={saveStr} />}
      {modal === 'governance' && <GovernanceModal draft={dGov} set={setDGov} rolesText={rolesText} setRolesText={setRolesText} onClose={() => setModal(null)} onSave={saveGov} />}
    </div>
  );
}
